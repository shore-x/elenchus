// Elenchus - SQLite Session Persistence
// Stores the full durable session history in SQLite while reconstructing only the
// recovery working set that the runtime needs on cold start.
// Message persistence is append-only: new messages are inserted with version=1,
// updated messages (e.g. proposal status changes) are appended with version=last+1.
// Context construction queries deduplicate by taking the latest version per message_id.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { SessionPersistenceAdapter } from "../../../application/session-persistence.js";
import { createHash } from "node:crypto";
import type {
  AgentId,
  CommittedStep,
  CompressionManagerSnapshot,
  ContextRecipeData,
  ContextTruncationReason,
  ConversationMessage,
  DeliberationUnitSnapshot,
  MemorySnapshot,
  PersistedChildSnapshot,
  SequencedConversationMessage,
  ToolLevel,
} from "../../../core/types.js";

const DEFAULT_SESSION_ID = "session-default";
const DEFAULT_REMINDER_THRESHOLD_CHARS = 120_000;
const DEFAULT_RECENT_RAW_TARGET_CHARS = 24_000;
const DEFAULT_MAX_RETRIES = 1;
const AGENT_IDS: AgentId[] = ["agent-a", "agent-b"];
const CURRENT_SCHEMA_VERSION = "12";

interface SqliteSessionPersistenceOptions {
  workspaceRoot: string;
  projectRoot: string;
}

interface SessionRow {
  session_id: string;
  root_unit_id: string;
}

interface UnitRow {
  unit_id: string;
  level: DeliberationUnitSnapshot["level"];
  path: string;
  workspace_root: string;
  project_root: string;
  state: DeliberationUnitSnapshot["state"];
  turn_counter: number;
  child_counter: number;
  sleep_deadline_ms: number | null;
}

interface ChildRelationRow {
  child_key: string;
  child_unit_id: string;
}

interface CursorRow {
  agent_id: AgentId;
  cursor_exclusive: number;
}

interface MessageRow {
  seq: number;
  body: string;
}

interface PendingProposalSeqRow {
  seq: number;
}

interface VersionRow {
  max_version: number;
}

interface CountRow {
  total: number;
}

interface CommittedStepRow {
  tool_name: string;
  proposed_step: string;
  proposed_by: AgentId;
  committed_at: number;
}

interface ContextTextHistoryRow {
  rowid: number;
  content: string;
  metadata: string;
  created_at: number;
}

interface MemoryStateFromHistory {
  content: string | null;
  metadata: string | null;
  created_at: number | null;
}

interface CompressionStateRow {
  active_task_id: string | null;
  requirements: string | null;
  source_message_count: number | null;
  attempt_number: number | null;
  max_attempts: number | null;
  started_at: number | null;
  reminder_threshold_chars: number;
  recent_raw_target_chars: number;
  max_retries: number;
}

interface RecipeRow {
  recipe_id: number;
  unit_id: string;
  agent_id: string;
  recent_raw_start_seq: number;
  visible_end_seq: number;
  newly_visible_seq: number | null;
  memory_snapshot_rowid: number | null;
  agent_md_rowid: number | null;
  level: string;
  has_pending_from_other: number;
  has_children: number;
  can_spawn_child: number;
  compression_reminder_shown: number;
  compression_reminder_chars: number | null;
  compression_reminder_threshold_chars: number | null;
  truncation_applied: number;
  truncation_reason: string;
  truncation_level: number;
  effective_turn: number;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hashPath(absolutePath: string): string {
  // Simple deterministic hash for project directory identification.
  // Uses a basic hash to avoid importing crypto for this purpose.
  let hash = 0;
  for (let i = 0; i < absolutePath.length; i++) {
    const char = absolutePath.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}

function toAgentCursorExclusive(sequenceStart: number, cursorIndex: number): number {
  return (sequenceStart - 1) + cursorIndex;
}

function buildMessageMetadata(message: ConversationMessage): {
  agentId: AgentId | null;
  proposalStatus: string | null;
  proposalRefMessageId: string | null;
  toolName: string | null;
  deliveryMode: string | null;
  success: number | null;
} {
  if (message.kind === "proposal_message") {
    return {
      agentId: message.authoredBy,
      proposalStatus: message.status,
      proposalRefMessageId: null,
      toolName: message.toolName,
      deliveryMode: null,
      success: null,
    };
  }

  if (message.kind === "vote_message") {
    return {
      agentId: message.authoredBy,
      proposalStatus: null,
      proposalRefMessageId: message.proposalId,
      toolName: null,
      deliveryMode: null,
      success: null,
    };
  }

  if (message.kind === "tool_result_message") {
    return {
      agentId: null,
      proposalStatus: null,
      proposalRefMessageId: message.proposalId,
      toolName: message.toolName,
      deliveryMode: null,
      success: message.success ? 1 : 0,
    };
  }

  if (message.kind === "upward_message") {
    return {
      agentId: null,
      proposalStatus: null,
      proposalRefMessageId: null,
      toolName: null,
      deliveryMode: message.deliveryMode,
      success: null,
    };
  }

  if (message.kind === "child_report_message") {
    return {
      agentId: null,
      proposalStatus: null,
      proposalRefMessageId: null,
      toolName: null,
      deliveryMode: message.deliveryMode,
      success: null,
    };
  }

  return {
    agentId: message.authoredBy === "agent-a" || message.authoredBy === "agent-b" ? message.authoredBy : null,
    proposalStatus: null,
    proposalRefMessageId: null,
    toolName: null,
    deliveryMode: null,
    success: null,
  };
}

export class SqliteSessionPersistence implements SessionPersistenceAdapter {
  private readonly db: InstanceType<typeof Database>;

  constructor(options: SqliteSessionPersistenceOptions) {
    const projectHash = hashPath(options.projectRoot);
    const storageDir = join(options.workspaceRoot, ".elenchus-state");
    mkdirSync(storageDir, { recursive: true });
    this.db = new Database(join(storageDir, "state.db"));
    this.db.pragma("foreign_keys = OFF");
    this.initializeSchema();
  }

  close(): void {
    this.db.close();
  }

  appendMessage(unitId: string, seq: number, message: ConversationMessage): void {
    const metadata = buildMessageMetadata(message);
    this.db.prepare(`
      INSERT INTO ledger_messages (
        message_id, unit_id, seq, version, kind, turn_authored, visible_from_turn,
        created_at, agent_id, proposal_status, proposal_ref_message_id,
        tool_name, delivery_mode, success, body
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      unitId,
      seq,
      message.kind,
      message.turnAuthored,
      message.visibleFromTurn,
      message.timestamp,
      metadata.agentId,
      metadata.proposalStatus,
      metadata.proposalRefMessageId,
      metadata.toolName,
      metadata.deliveryMode,
      metadata.success,
      JSON.stringify(message),
    );
  }

  updateMessage(unitId: string, message: ConversationMessage): void {
    const metadata = buildMessageMetadata(message);
    const currentVersion = (this.db
      .prepare(`SELECT MAX(version) AS max_version FROM ledger_messages WHERE message_id = ?`)
      .get(message.id) as VersionRow | undefined)?.max_version ?? 0;
    const nextVersion = currentVersion + 1;
    const seq = (this.db
      .prepare(`SELECT seq FROM ledger_messages WHERE message_id = ? AND version = ?`)
      .get(message.id, currentVersion) as { seq: number } | undefined)?.seq;

    if (seq === undefined) {
      throw new Error(`Cannot update message ${message.id}: no previous version found in ledger_messages`);
    }

    this.db.prepare(`
      INSERT INTO ledger_messages (
        message_id, unit_id, seq, version, kind, turn_authored, visible_from_turn,
        created_at, agent_id, proposal_status, proposal_ref_message_id,
        tool_name, delivery_mode, success, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      unitId,
      seq,
      nextVersion,
      message.kind,
      message.turnAuthored,
      message.visibleFromTurn,
      message.timestamp,
      metadata.agentId,
      metadata.proposalStatus,
      metadata.proposalRefMessageId,
      metadata.toolName,
      metadata.deliveryMode,
      metadata.success,
      JSON.stringify(message),
    );
  }

  loadSnapshot(): DeliberationUnitSnapshot | null {
    const sessionRow = this.db
      .prepare(`SELECT session_id, root_unit_id FROM sessions WHERE session_id = ? LIMIT 1`)
      .get(DEFAULT_SESSION_ID) as SessionRow | undefined;

    if (!sessionRow) {
      return null;
    }

    this.db
      .prepare(`UPDATE sessions SET last_recovered_at = ?, updated_at = updated_at WHERE session_id = ?`)
      .run(Date.now(), DEFAULT_SESSION_ID);

    return this.loadUnitSnapshot(sessionRow.root_unit_id);
  }

  saveSnapshot(snapshot: DeliberationUnitSnapshot): void {
    const now = Date.now();
    const write = this.db.transaction((rootSnapshot: DeliberationUnitSnapshot) => {
      this.db.prepare(`
        INSERT INTO sessions (session_id, root_unit_id, status, created_at, updated_at, last_recovered_at)
        VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT(session_id) DO UPDATE SET
          root_unit_id = excluded.root_unit_id,
          status = excluded.status,
          updated_at = excluded.updated_at
      `).run(
        DEFAULT_SESSION_ID,
        rootSnapshot.unitId,
        rootSnapshot.state === "terminated" ? "terminated" : "active",
        now,
        now,
      );

      this.saveUnitSnapshot(rootSnapshot, DEFAULT_SESSION_ID, now);
    });

    write(snapshot);
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const currentSchemaVersion = (this.db
      .prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`)
      .get() as { value: string } | undefined)?.value ?? null;

    if (currentSchemaVersion !== CURRENT_SCHEMA_VERSION) {
      this.rebuildSchema();
    }

    this.ensureSchema();
  }

  private rebuildSchema(): void {
    this.db.exec(`
      DROP TABLE IF EXISTS context_recipe;
      DROP TABLE IF EXISTS context_text_history;
      DROP TABLE IF EXISTS unit_compression_state;
      DROP TABLE IF EXISTS unit_memory_state;
      DROP TABLE IF EXISTS committed_steps;
      DROP TABLE IF EXISTS ledger_messages;
      DROP TABLE IF EXISTS unit_agent_cursors;
      DROP TABLE IF EXISTS unit_children;
      DROP TABLE IF EXISTS units;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS schema_meta;
    `);
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        root_unit_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_recovered_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS units (
        unit_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        level TEXT NOT NULL,
        path TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        project_root TEXT NOT NULL,
        state TEXT NOT NULL,
        turn_counter INTEGER NOT NULL,
        child_counter INTEGER NOT NULL,
        sleep_deadline_ms INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        terminated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS unit_children (
        parent_unit_id TEXT NOT NULL,
        child_key TEXT NOT NULL,
        child_unit_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(parent_unit_id, child_key),
        UNIQUE(child_unit_id)
      );

      CREATE TABLE IF NOT EXISTS unit_agent_cursors (
        unit_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        cursor_exclusive INTEGER NOT NULL,
        PRIMARY KEY(unit_id, agent_id)
      );

      CREATE TABLE IF NOT EXISTS ledger_messages (
        message_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        kind TEXT NOT NULL,
        turn_authored INTEGER NOT NULL,
        visible_from_turn INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        agent_id TEXT,
        proposal_status TEXT,
        proposal_ref_message_id TEXT,
        tool_name TEXT,
        delivery_mode TEXT,
        success INTEGER,
        body TEXT NOT NULL,
        UNIQUE(message_id, version)
      );

      CREATE TABLE IF NOT EXISTS committed_steps (
        unit_id TEXT NOT NULL,
        step_seq INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        proposed_step TEXT NOT NULL,
        proposed_by TEXT NOT NULL,
        committed_at INTEGER NOT NULL,
        PRIMARY KEY(unit_id, step_seq)
      );

      CREATE TABLE IF NOT EXISTS context_text_history (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        unit_id TEXT NOT NULL,
        category TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        effective_turn INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_ctx_text_dedup
        ON context_text_history(unit_id, category, content_hash);

      CREATE INDEX IF NOT EXISTS idx_ctx_text_unit_category_id
        ON context_text_history(unit_id, category, rowid DESC);

      CREATE TABLE IF NOT EXISTS context_recipe (
        recipe_id INTEGER PRIMARY KEY AUTOINCREMENT,
        unit_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        recent_raw_start_seq INTEGER NOT NULL,
        visible_end_seq INTEGER NOT NULL,
        newly_visible_seq INTEGER,
        memory_snapshot_rowid INTEGER,
        agent_md_rowid INTEGER,
        level TEXT NOT NULL,
        has_pending_from_other INTEGER NOT NULL DEFAULT 0,
        has_children INTEGER NOT NULL DEFAULT 0,
        can_spawn_child INTEGER NOT NULL DEFAULT 0,
        compression_reminder_shown INTEGER NOT NULL DEFAULT 0,
        compression_reminder_chars INTEGER,
        compression_reminder_threshold_chars INTEGER,
        truncation_applied INTEGER NOT NULL DEFAULT 0,
        truncation_reason TEXT NOT NULL DEFAULT 'none',
        truncation_level INTEGER NOT NULL DEFAULT 0,
        output_message_id TEXT,
        effective_turn INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_recipe_output_message
        ON context_recipe(output_message_id)
        WHERE output_message_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS unit_compression_state (
        unit_id TEXT PRIMARY KEY,
        active_task_id TEXT,
        requirements TEXT,
        source_message_count INTEGER,
        attempt_number INTEGER,
        max_attempts INTEGER,
        started_at INTEGER,
        reminder_threshold_chars INTEGER NOT NULL,
        recent_raw_target_chars INTEGER NOT NULL,
        max_retries INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_unit_seq
      ON ledger_messages(unit_id, seq);

      CREATE INDEX IF NOT EXISTS idx_ledger_unit_visible_turn
      ON ledger_messages(unit_id, visible_from_turn, seq);

      CREATE INDEX IF NOT EXISTS idx_ledger_unit_kind_seq
      ON ledger_messages(unit_id, kind, seq);

      CREATE INDEX IF NOT EXISTS idx_ledger_pending_proposal
      ON ledger_messages(unit_id, proposal_status, seq)
      WHERE kind = 'proposal_message';

      CREATE INDEX IF NOT EXISTS idx_unit_children_parent
      ON unit_children(parent_unit_id, child_key);

      CREATE INDEX IF NOT EXISTS idx_committed_steps_unit_recent
      ON committed_steps(unit_id, committed_at DESC);
    `);

    this.db.prepare(`
      INSERT INTO schema_meta (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(CURRENT_SCHEMA_VERSION);
  }

  private saveUnitSnapshot(snapshot: DeliberationUnitSnapshot, sessionId: string, now: number): void {
    this.db.prepare(`
      INSERT INTO units (
        unit_id, session_id, level, path, workspace_root, project_root,
        state, turn_counter, child_counter,
        sleep_deadline_ms, created_at, updated_at, terminated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit_id) DO UPDATE SET
        session_id = excluded.session_id,
        level = excluded.level,
        path = excluded.path,
        workspace_root = excluded.workspace_root,
        project_root = excluded.project_root,
        state = excluded.state,
        turn_counter = excluded.turn_counter,
        child_counter = excluded.child_counter,
        sleep_deadline_ms = excluded.sleep_deadline_ms,
        updated_at = excluded.updated_at,
        terminated_at = excluded.terminated_at
    `).run(
      snapshot.unitId,
      sessionId,
      snapshot.level,
      JSON.stringify(snapshot.path),
      snapshot.workspaceRoot,
      snapshot.projectRoot,
      snapshot.state,
      snapshot.turnCounter,
      snapshot.childCounter,
      snapshot.sleepDeadlineMs,
      now,
      now,
      snapshot.state === "terminated" ? now : null,
    );

    this.saveLedgerSnapshot(snapshot.unitId, snapshot);
    this.saveCommittedSteps(snapshot.unitId, snapshot.commitLog);
    this.saveMemoryAndCompressionState(snapshot.unitId, snapshot);

    for (const child of snapshot.children) {
      this.saveUnitSnapshot(child.snapshot, sessionId, now);
    }

    this.saveChildRelations(snapshot.unitId, snapshot.children, now);
  }

  private saveLedgerSnapshot(unitId: string, snapshot: DeliberationUnitSnapshot): void {
    const ledgerSnapshot = snapshot.ledger;
    const upsertCursor = this.db.prepare(`
      INSERT INTO unit_agent_cursors (unit_id, agent_id, cursor_exclusive)
      VALUES (?, ?, ?)
      ON CONFLICT(unit_id, agent_id) DO UPDATE SET
        cursor_exclusive = excluded.cursor_exclusive
    `);

    for (const agentId of AGENT_IDS) {
      upsertCursor.run(
        unitId,
        agentId,
        toAgentCursorExclusive(ledgerSnapshot.sequenceStart, ledgerSnapshot.cursors[agentId]),
      );
    }
  }

  private saveCommittedSteps(unitId: string, commitLog: readonly CommittedStep[]): void {
    this.db.prepare(`DELETE FROM committed_steps WHERE unit_id = ?`).run(unitId);
    const insertStep = this.db.prepare(`
      INSERT INTO committed_steps (
        unit_id, step_seq, tool_name, proposed_step, proposed_by, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    commitLog.forEach((step, index) => {
      insertStep.run(
        unitId,
        index + 1,
        step.toolName,
        step.proposedStep,
        step.proposedBy,
        step.committedAt,
      );
    });
  }

  private saveMemoryAndCompressionState(unitId: string, snapshot: DeliberationUnitSnapshot): void {
    const ledgerSnapshot = snapshot.ledger;
    const memorySnapshot = snapshot.compression.memorySnapshot;
    const recentRawStartSeq = ledgerSnapshot.messages.length === 0
      ? ledgerSnapshot.sequenceStart
      : ledgerSnapshot.sequenceStart + clamp(snapshot.compression.recentRawStartIndex, 0, ledgerSnapshot.messages.length - 1);

    if (memorySnapshot) {
      const metadata = JSON.stringify({
        sourceMessageCount: memorySnapshot.sourceMessageCount,
        requirements: memorySnapshot.requirements,
        recentRawStartSeq,
      });
      this.saveContextTextHistoryInternal(unitId, "memory_snapshot", memorySnapshot.content, metadata, memorySnapshot.createdAt);
    }

    this.db.prepare(`
      INSERT INTO unit_compression_state (
        unit_id, active_task_id, requirements, source_message_count, attempt_number,
        max_attempts, started_at, reminder_threshold_chars, recent_raw_target_chars, max_retries
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit_id) DO UPDATE SET
        active_task_id = excluded.active_task_id,
        requirements = excluded.requirements,
        source_message_count = excluded.source_message_count,
        attempt_number = excluded.attempt_number,
        max_attempts = excluded.max_attempts,
        started_at = excluded.started_at,
        reminder_threshold_chars = excluded.reminder_threshold_chars,
        recent_raw_target_chars = excluded.recent_raw_target_chars,
        max_retries = excluded.max_retries
    `).run(
      unitId,
      snapshot.compression.activeTask?.id ?? null,
      snapshot.compression.activeTask?.requirements ?? null,
      snapshot.compression.activeTask?.sourceMessageCount ?? null,
      snapshot.compression.activeTask?.attemptNumber ?? null,
      snapshot.compression.activeTask?.maxAttempts ?? null,
      snapshot.compression.activeTask?.startedAt ?? null,
      snapshot.compression.reminderThresholdChars,
      snapshot.compression.recentRawTargetChars,
      snapshot.compression.maxRetries,
    );
  }

  private saveChildRelations(parentUnitId: string, children: readonly PersistedChildSnapshot[], now: number): void {
    const upsertChild = this.db.prepare(`
      INSERT INTO unit_children (
        parent_unit_id, child_key, child_unit_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(parent_unit_id, child_key) DO UPDATE SET
        child_unit_id = excluded.child_unit_id,
        updated_at = excluded.updated_at
    `);

    for (const child of children) {
      upsertChild.run(
        parentUnitId,
        child.childId,
        child.snapshot.unitId,
        now,
        now,
      );
    }

    if (children.length === 0) {
      this.db.prepare(`DELETE FROM unit_children WHERE parent_unit_id = ?`).run(parentUnitId);
      return;
    }

    const placeholders = children.map(() => "?").join(", ");
    this.db.prepare(`
      DELETE FROM unit_children
      WHERE parent_unit_id = ?
        AND child_key NOT IN (${placeholders})
    `).run(parentUnitId, ...children.map((child) => child.childId));
  }

  private loadUnitSnapshot(unitId: string): DeliberationUnitSnapshot {
    const unitRow = this.db
      .prepare(`
        SELECT unit_id, level, path, workspace_root, project_root, state, turn_counter, child_counter, sleep_deadline_ms
        FROM units
        WHERE unit_id = ?
      `)
      .get(unitId) as UnitRow | undefined;

    if (!unitRow) {
      throw new Error(`Persisted unit ${unitId} not found in SQLite session store.`);
    }

    const totalMessages = ((this.db
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS total FROM ledger_messages WHERE unit_id = ?`)
      .get(unitId) as CountRow | undefined)?.total) ?? 0;
    const pendingProposalSeq = (this.db
      .prepare(`
        SELECT MIN(seq) AS seq
        FROM (
          SELECT seq, proposal_status, ROW_NUMBER() OVER (
            PARTITION BY message_id ORDER BY version DESC
          ) AS rn
          FROM ledger_messages
          WHERE unit_id = ? AND kind = 'proposal_message'
        )
        WHERE rn = 1 AND proposal_status = 'pending'
      `)
      .get(unitId) as PendingProposalSeqRow | undefined)?.seq;
    const memoryRow = this.db
      .prepare(`
        SELECT rowid, content, metadata, created_at
        FROM context_text_history
        WHERE unit_id = ? AND category = 'memory_snapshot'
        ORDER BY rowid DESC LIMIT 1
      `)
      .get(unitId) as ContextTextHistoryRow | undefined;
    const compressionRow = this.db
      .prepare(`
        SELECT active_task_id, requirements, source_message_count, attempt_number,
               max_attempts, started_at, reminder_threshold_chars,
               recent_raw_target_chars, max_retries
        FROM unit_compression_state
        WHERE unit_id = ?
      `)
      .get(unitId) as CompressionStateRow | undefined;
    const sequenceStart = this.computeSequenceStart(totalMessages, memoryRow, pendingProposalSeq ?? null);
    const messages = this.db
      .prepare(`
        SELECT body FROM (
          SELECT body, seq, ROW_NUMBER() OVER (
            PARTITION BY message_id ORDER BY version DESC
          ) AS rn
          FROM ledger_messages
          WHERE unit_id = ? AND seq >= ?
        ) WHERE rn = 1
        ORDER BY seq ASC
      `)
      .all(unitId, sequenceStart) as MessageRow[];
    const restoredMessages = messages.map((row) => parseJson<ConversationMessage>(row.body));
    const cursorRows = this.db
      .prepare(`
        SELECT agent_id, cursor_exclusive
        FROM unit_agent_cursors
        WHERE unit_id = ?
      `)
      .all(unitId) as CursorRow[];
    const cursorMap = new Map(cursorRows.map((row) => [row.agent_id, row.cursor_exclusive]));
    const cursors = {
      "agent-a": this.toRelativeCursor(cursorMap.get("agent-a") ?? 0, sequenceStart, restoredMessages.length),
      "agent-b": this.toRelativeCursor(cursorMap.get("agent-b") ?? 0, sequenceStart, restoredMessages.length),
    } satisfies DeliberationUnitSnapshot["ledger"]["cursors"];
    const memorySnapshot = this.buildMemorySnapshot(memoryRow);
    const compressionSnapshot = this.buildCompressionSnapshot(
      compressionRow,
      memorySnapshot,
      memoryRow,
      sequenceStart,
      restoredMessages.length,
    );
    const commitLog = this.db
      .prepare(`
        SELECT tool_name, proposed_step, proposed_by, committed_at
        FROM committed_steps
        WHERE unit_id = ?
        ORDER BY step_seq ASC
      `)
      .all(unitId) as CommittedStepRow[];
    const childRows = this.db
      .prepare(`
        SELECT child_key, child_unit_id
        FROM unit_children
        WHERE parent_unit_id = ?
        ORDER BY child_key ASC
      `)
      .all(unitId) as ChildRelationRow[];

    return {
      unitId: unitRow.unit_id,
      level: unitRow.level,
      path: parseJson<number[]>(unitRow.path),
      workspaceRoot: unitRow.workspace_root,
      projectRoot: unitRow.project_root,
      state: unitRow.state,
      turnCounter: unitRow.turn_counter,
      childCounter: unitRow.child_counter,
      sleepDeadlineMs: unitRow.sleep_deadline_ms,
      ledger: {
        sequenceStart,
        totalMessages,
        messages: restoredMessages,
        cursors,
      },
      compression: compressionSnapshot,
      commitLog: commitLog.map((step) => ({
        toolName: step.tool_name,
        proposedStep: step.proposed_step,
        proposedBy: step.proposed_by,
        committedAt: step.committed_at,
      })),
      children: childRows.map((child) => ({
        childId: child.child_key,
        snapshot: this.loadUnitSnapshot(child.child_unit_id),
      })),
    };
  }

  private computeSequenceStart(
    totalMessages: number,
    memoryRow: ContextTextHistoryRow | undefined,
    pendingProposalSeq: number | null,
  ): number {
    if (totalMessages <= 0) {
      return 1;
    }

    let start = 1;
    if (memoryRow?.content) {
      const meta = memoryRow.metadata ? JSON.parse(memoryRow.metadata) as { recentRawStartSeq?: number } : {};
      start = clamp(meta.recentRawStartSeq ?? 1, 1, totalMessages);
    }
    if (pendingProposalSeq !== null) {
      start = Math.min(start, pendingProposalSeq);
    }
    return start;
  }

  private toRelativeCursor(cursorExclusive: number, sequenceStart: number, messageCount: number): number {
    return clamp(cursorExclusive - (sequenceStart - 1), 0, messageCount);
  }

  private buildMemorySnapshot(row: ContextTextHistoryRow | undefined): MemorySnapshot | null {
    if (!row?.content) {
      return null;
    }

    const meta = row.metadata ? JSON.parse(row.metadata) as { sourceMessageCount?: number; requirements?: string } : {};
    return {
      content: row.content,
      sourceMessageCount: meta.sourceMessageCount ?? 0,
      requirements: meta.requirements ?? "",
      createdAt: row.created_at ?? 0,
    };
  }

  private buildCompressionSnapshot(
    row: CompressionStateRow | undefined,
    memorySnapshot: MemorySnapshot | null,
    memoryRow: ContextTextHistoryRow | undefined,
    sequenceStart: number,
    messageCount: number,
  ): CompressionManagerSnapshot {
    const meta = memoryRow?.metadata ? JSON.parse(memoryRow.metadata) as { recentRawStartSeq?: number } : {};
    const recentRawStartIndex = memoryRow?.content
      ? clamp((meta.recentRawStartSeq ?? 1) - sequenceStart, 0, messageCount)
      : 0;

    return {
      activeTask: row?.active_task_id
        ? {
          id: row.active_task_id,
          requirements: row.requirements ?? "",
          sourceMessageCount: row.source_message_count ?? 0,
          attemptNumber: row.attempt_number ?? 1,
          maxAttempts: row.max_attempts ?? DEFAULT_MAX_RETRIES + 1,
          startedAt: row.started_at ?? 0,
        }
        : null,
      memorySnapshot,
      recentRawStartIndex,
      reminderThresholdChars: row?.reminder_threshold_chars ?? DEFAULT_REMINDER_THRESHOLD_CHARS,
      recentRawTargetChars: row?.recent_raw_target_chars ?? DEFAULT_RECENT_RAW_TARGET_CHARS,
      maxRetries: row?.max_retries ?? DEFAULT_MAX_RETRIES,
    };
  }

  private saveContextTextHistoryInternal(
    unitId: string,
    category: string,
    content: string,
    metadata: string,
    createdAt: number,
  ): number {
    const contentHash = createHash("sha256").update(content).digest("hex");
    const existing = this.db.prepare(
      `SELECT rowid FROM context_text_history WHERE unit_id = ? AND category = ? AND content_hash = ?`,
    ).get(unitId, category, contentHash) as { rowid: number } | undefined;
    if (existing) {
      return existing.rowid;
    }
    const result = this.db.prepare(
      `INSERT INTO context_text_history (unit_id, category, content_hash, content, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(unitId, category, contentHash, content, metadata, createdAt);
    return Number(result.lastInsertRowid);
  }

  saveContextTextHistory(unitId: string, category: string, content: string, metadata: string): number {
    return this.saveContextTextHistoryInternal(unitId, category, content, metadata, Date.now());
  }

  getLatestContextTextHistory(unitId: string, category: string): { rowid: number; content: string; metadata: string } | null {
    const row = this.db.prepare(
      `SELECT rowid, content, metadata FROM context_text_history WHERE unit_id = ? AND category = ? ORDER BY rowid DESC LIMIT 1`,
    ).get(unitId, category) as ContextTextHistoryRow | undefined;
    if (!row) return null;
    return { rowid: row.rowid, content: row.content, metadata: row.metadata };
  }

  createRecipe(recipe: ContextRecipeData): number {
    const result = this.db.prepare(
      `INSERT INTO context_recipe (
        unit_id, agent_id, recent_raw_start_seq, visible_end_seq, newly_visible_seq,
        memory_snapshot_rowid, agent_md_rowid, level,
        has_pending_from_other, has_children, can_spawn_child,
        compression_reminder_shown, compression_reminder_chars, compression_reminder_threshold_chars,
        truncation_applied, truncation_reason, truncation_level,
        effective_turn, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      recipe.unitId,
      recipe.agentId,
      recipe.recentRawStartSeq,
      recipe.visibleEndSeq,
      recipe.newlyVisibleSeq,
      recipe.memorySnapshotRowid,
      recipe.agentMdRowid,
      recipe.level,
      recipe.hasPendingFromOther ? 1 : 0,
      recipe.hasChildren ? 1 : 0,
      recipe.canSpawnChild ? 1 : 0,
      recipe.compressionReminderShown ? 1 : 0,
      recipe.compressionReminderChars,
      recipe.compressionReminderThresholdChars,
      recipe.truncationApplied ? 1 : 0,
      recipe.truncationReason,
      recipe.truncationLevel,
      recipe.effectiveTurn,
      Date.now(),
    );
    return Number(result.lastInsertRowid);
  }

  updateRecipeOutputMessageId(recipeId: number, outputMessageId: string): void {
    this.db.prepare(
      `UPDATE context_recipe SET output_message_id = ? WHERE recipe_id = ?`,
    ).run(outputMessageId, recipeId);
  }

  getRecipeByOutputMessageId(messageId: string): ContextRecipeData | null {
    const row = this.db.prepare(
      `SELECT recipe_id, unit_id, agent_id, recent_raw_start_seq, visible_end_seq, newly_visible_seq,
              memory_snapshot_rowid, agent_md_rowid, level,
              has_pending_from_other, has_children, can_spawn_child,
              compression_reminder_shown, compression_reminder_chars, compression_reminder_threshold_chars,
              truncation_applied, truncation_reason, truncation_level, effective_turn
       FROM context_recipe WHERE output_message_id = ? LIMIT 1`,
    ).get(messageId) as RecipeRow | undefined;
    if (!row) return null;
    return {
      unitId: row.unit_id,
      agentId: row.agent_id as AgentId,
      recentRawStartSeq: row.recent_raw_start_seq,
      visibleEndSeq: row.visible_end_seq,
      newlyVisibleSeq: row.newly_visible_seq,
      memorySnapshotRowid: row.memory_snapshot_rowid,
      agentMdRowid: row.agent_md_rowid,
      level: row.level as ToolLevel,
      hasPendingFromOther: row.has_pending_from_other !== 0,
      hasChildren: row.has_children !== 0,
      canSpawnChild: row.can_spawn_child !== 0,
      compressionReminderShown: row.compression_reminder_shown !== 0,
      compressionReminderChars: row.compression_reminder_chars,
      compressionReminderThresholdChars: row.compression_reminder_threshold_chars,
      truncationApplied: row.truncation_applied !== 0,
      truncationReason: row.truncation_reason as ContextTruncationReason,
      truncationLevel: row.truncation_level,
      effectiveTurn: row.effective_turn,
    };
  }

  getContextTextHistoryByRowid(rowid: number): { content: string; metadata: string } | null {
    const row = this.db.prepare(
      `SELECT content, metadata FROM context_text_history WHERE rowid = ?`,
    ).get(rowid) as Pick<ContextTextHistoryRow, "content" | "metadata"> | undefined;
    if (!row) return null;
    return { content: row.content, metadata: row.metadata };
  }

  getLedgerMessagesBySeqRange(unitId: string, startSeq: number, endSeq: number): SequencedConversationMessage[] {
    const rows = this.db.prepare(
      `SELECT seq, body FROM (
        SELECT body, seq, message_id, version,
               ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version DESC) AS rn
        FROM ledger_messages
        WHERE unit_id = ? AND seq >= ? AND seq < ?
      ) WHERE rn = 1
      ORDER BY seq ASC`,
    ).all(unitId, startSeq, endSeq) as MessageRow[];
    return rows.map((row) => ({
      seq: row.seq,
      message: parseJson<ConversationMessage>(row.body),
    }));
  }
}
