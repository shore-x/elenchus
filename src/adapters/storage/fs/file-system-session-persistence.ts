// Elenchus - FileSystem Session Persistence
// Stores the recoverable root deliberation graph under workspaceRoot/.elenchus-state/.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DeliberationUnitSnapshot } from "../../../core/types.js";
import type { SessionPersistenceAdapter } from "../../../application/session-persistence.js";

interface PersistedSessionFile {
  version: 1;
  savedAt: number;
  rootSnapshot: DeliberationUnitSnapshot;
}

function hashPath(absolutePath: string): string {
  let hash = 0;
  for (let i = 0; i < absolutePath.length; i++) {
    const char = absolutePath.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}

export interface FileSystemSessionPersistenceOptions {
  workspaceRoot: string;
  projectRoot: string;
}

export class FileSystemSessionPersistence implements SessionPersistenceAdapter {
  private readonly storageDir: string;
  private readonly sessionFilePath: string;

  constructor(options: FileSystemSessionPersistenceOptions) {
    this.storageDir = join(options.workspaceRoot, ".elenchus-state");
    this.sessionFilePath = join(this.storageDir, "session.json");
  }

  loadSnapshot(): DeliberationUnitSnapshot | null {
    if (!existsSync(this.sessionFilePath)) {
      return null;
    }

    const raw = readFileSync(this.sessionFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedSessionFile>;

    if (parsed.version !== 1 || !parsed.rootSnapshot) {
      throw new Error(`Invalid persisted Elenchus session file: ${this.sessionFilePath}`);
    }

    return parsed.rootSnapshot;
  }

  saveSnapshot(snapshot: DeliberationUnitSnapshot): void {
    mkdirSync(this.storageDir, { recursive: true });

    const payload: PersistedSessionFile = {
      version: 1,
      savedAt: Date.now(),
      rootSnapshot: snapshot,
    };
    const tempPath = `${this.sessionFilePath}.tmp`;

    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    mkdirSync(dirname(this.sessionFilePath), { recursive: true });
    renameSync(tempPath, this.sessionFilePath);
  }
}
