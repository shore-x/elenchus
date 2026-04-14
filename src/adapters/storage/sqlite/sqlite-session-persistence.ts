// Elenchus - SQLite Session Persistence
// Stores the full durable session history in SQLite while reconstructing only the
// recovery working set that the runtime needs on cold start.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { SessionPersistenceAdapter } from "../../../application/session-persistence.js";
import type {
  AgentId,
  CommittedStep,
  CompressionManagerSnapshot,
  ConversationMessage,
  DeliberationUnitSnapshot,
  MemorySnapshot,
  PersistedChildSnapshot,
} from "../../../core/types.js";

const DEFAULT_SESSION_ID = "session-default";
const DEFAULT_REMINDER_THRESHOLD_CHARS = 120_000;
const DEFAULT_RECENT_RAW_TARGET_CHARS = 24_000;
const DEFAULT_MAX_RETRIES = 1;
const AGENT_IDS: AgentId[] = ["agent-a", "agent-b"];
const CURRENT_SCHEMA_VERSION = "4";

interface SqliteSessionPersistenceOptions {
  runDirectory: string;
}

interface SessionRow {
  session_id: string;
  root_unit_id: string;
}

interface UnitRow {
  unit_id: string;
  level: DeliberationUnitSnapshot["level"];
  path: string;
  state: DeliberationUnitSnapshot["state"];
  turn_counter: number;
  child_counter: number;
  sleep_deadline_ms: number | null;
}

interface ChildRelationRow {
  child_key: string;
  child_unit_id: string;
  mounted: number;
}

interface CursorRow {
  agent_id: AgentId;
  cursor_exclusive: number;
}

interface MessageRow {
  body: string;
}

interface PendingProposalSeqRow {
  seq: number;
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

interface MemoryStateRow {
  snapshot_text: string | null;
  source_message_count: number;
  requirements: string | null;
  created_at: number | null;
  recent_raw_start_seq: number;
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

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
    const storageDir = join(options.runDirectory, ".elenchus");
    mkdirSync(storageDir, { recursive: true });
    this.db = new Database(join(storageDir, "state.db"));
    this.db.pragma("foreign_keys = OFF");
    this.initializeSchema();
  }

  close(): void {
    this.db.close();
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
        mounted INTEGER NOT NULL,
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
        message_id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
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
        UNIQUE(unit_id, seq)
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

      CREATE TABLE IF NOT EXISTS unit_memory_state (
        unit_id TEXT PRIMARY KEY,
        snapshot_text TEXT,
        source_message_count INTEGER NOT NULL DEFAULT 0,
        requirements TEXT,
        created_at INTEGER,
        recent_raw_start_seq INTEGER NOT NULL DEFAULT 1
      );

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

      CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_unit_seq
      ON ledger_messages(unit_id, seq);

      CREATE INDEX IF NOT EXISTS idx_ledger_unit_visible_turn
      ON ledger_messages(unit_id, visible_from_turn, seq);

      CREATE INDEX IF NOT EXISTS idx_ledger_unit_kind_seq
      ON ledger_messages(unit_id, kind, seq);

      CREATE INDEX IF NOT EXISTS idx_ledger_pending_proposal
      ON ledger_messages(unit_id, proposal_status, seq)
      WHERE kind = 'proposal_message';

      CREATE INDEX IF NOT EXISTS idx_unit_children_parent_mounted
      ON unit_children(parent_unit_id, mounted, child_key);

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
        unit_id, session_id, level, path, state, turn_counter, child_counter,
        sleep_deadline_ms, created_at, updated_at, terminated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit_id) DO UPDATE SET
        session_id = excluded.session_id,
        level = excluded.level,
        path = excluded.path,
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
    const upsertMessage = this.db.prepare(`
      INSERT INTO ledger_messages (
        message_id, unit_id, seq, kind, turn_authored, visible_from_turn,
        created_at, agent_id, proposal_status, proposal_ref_message_id,
        tool_name, delivery_mode, success, body
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        unit_id = excluded.unit_id,
        seq = excluded.seq,
        kind = excluded.kind,
        turn_authored = excluded.turn_authored,
        visible_from_turn = excluded.visible_from_turn,
        created_at = excluded.created_at,
        agent_id = excluded.agent_id,
        proposal_status = excluded.proposal_status,
        proposal_ref_message_id = excluded.proposal_ref_message_id,
        tool_name = excluded.tool_name,
        delivery_mode = excluded.delivery_mode,
        success = excluded.success,
        body = excluded.body
    `);

    for (const agentId of AGENT_IDS) {
      upsertCursor.run(
        unitId,
        agentId,
        toAgentCursorExclusive(ledgerSnapshot.sequenceStart, ledgerSnapshot.cursors[agentId]),
      );
    }

    ledgerSnapshot.messages.forEach((message, index) => {
      const metadata = buildMessageMetadata(message);
      upsertMessage.run(
        message.id,
        unitId,
        ledgerSnapshot.sequenceStart + index,
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
    });
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

    this.db.prepare(`
      INSERT INTO unit_memory_state (
        unit_id, snapshot_text, source_message_count, requirements, created_at, recent_raw_start_seq
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit_id) DO UPDATE SET
        snapshot_text = excluded.snapshot_text,
        source_message_count = excluded.source_message_count,
        requirements = excluded.requirements,
        created_at = excluded.created_at,
        recent_raw_start_seq = excluded.recent_raw_start_seq
    `).run(
      unitId,
      memorySnapshot?.content ?? null,
      memorySnapshot?.sourceMessageCount ?? 0,
      memorySnapshot?.requirements ?? null,
      memorySnapshot?.createdAt ?? null,
      recentRawStartSeq,
    );

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
        parent_unit_id, child_key, child_unit_id, mounted, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(parent_unit_id, child_key) DO UPDATE SET
        child_unit_id = excluded.child_unit_id,
        mounted = excluded.mounted,
        updated_at = excluded.updated_at
    `);

    for (const child of children) {
      upsertChild.run(
        parentUnitId,
        child.childId,
        child.snapshot.unitId,
        child.mounted ? 1 : 0,
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
        SELECT unit_id, level, path, state, turn_counter, child_counter, sleep_deadline_ms
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
        FROM ledger_messages
        WHERE unit_id = ? AND kind = 'proposal_message' AND proposal_status = 'pending'
      `)
      .get(unitId) as PendingProposalSeqRow | undefined)?.seq;
    const memoryRow = this.db
      .prepare(`
        SELECT snapshot_text, source_message_count, requirements, created_at, recent_raw_start_seq
        FROM unit_memory_state
        WHERE unit_id = ?
      `)
      .get(unitId) as MemoryStateRow | undefined;
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
        SELECT body
        FROM ledger_messages
        WHERE unit_id = ? AND seq >= ?
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
        SELECT child_key, child_unit_id, mounted
        FROM unit_children
        WHERE parent_unit_id = ?
        ORDER BY child_key ASC
      `)
      .all(unitId) as ChildRelationRow[];

    return {
      unitId: unitRow.unit_id,
      level: unitRow.level,
      path: parseJson<number[]>(unitRow.path),
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
        mounted: child.mounted === 1,
        snapshot: this.loadUnitSnapshot(child.child_unit_id),
      })),
    };
  }

  private computeSequenceStart(
    totalMessages: number,
    memoryRow: MemoryStateRow | undefined,
    pendingProposalSeq: number | null,
  ): number {
    if (totalMessages <= 0) {
      return 1;
    }

    let start = 1;
    if (memoryRow?.snapshot_text) {
      start = clamp(memoryRow.recent_raw_start_seq, 1, totalMessages);
    }
    if (pendingProposalSeq !== null) {
      start = Math.min(start, pendingProposalSeq);
    }
    return start;
  }

  private toRelativeCursor(cursorExclusive: number, sequenceStart: number, messageCount: number): number {
    return clamp(cursorExclusive - (sequenceStart - 1), 0, messageCount);
  }

  private buildMemorySnapshot(row: MemoryStateRow | undefined): MemorySnapshot | null {
    if (!row?.snapshot_text) {
      return null;
    }

    return {
      content: row.snapshot_text,
      sourceMessageCount: row.source_message_count,
      requirements: row.requirements ?? "",
      createdAt: row.created_at ?? 0,
    };
  }

  private buildCompressionSnapshot(
    row: CompressionStateRow | undefined,
    memorySnapshot: MemorySnapshot | null,
    memoryRow: MemoryStateRow | undefined,
    sequenceStart: number,
    messageCount: number,
  ): CompressionManagerSnapshot {
    const recentRawStartIndex = memoryRow?.snapshot_text
      ? clamp(memoryRow.recent_raw_start_seq - sequenceStart, 0, messageCount)
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
}
