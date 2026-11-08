import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { jsonValue } from "../json.js";
import { isRunId, type RunId } from "../ids.js";
import { eventIdOf, type EventId } from "../types.js";

export type StoredEvent = {
  readonly id: EventId;
  readonly runId: RunId;
  readonly seq: number;
  readonly type: string;
  readonly payloadJson: string;
  readonly causationId: string | null;
  readonly idempotencyKey: string | null;
};

export type AppendInput = {
  readonly runId: RunId;
  readonly type: string;
  readonly payloadJson: string;
  readonly causationId: string | null;
  readonly idempotencyKey: string | null;
};

export type EventStore = {
  append(input: AppendInput): StoredEvent;
  list(runId: RunId): readonly StoredEvent[];
  count(runId: RunId): number;
  findByIdempotencyKey(key: string): StoredEvent | undefined;
  fold<T>(runId: RunId, initial: T, reduce: (state: T, event: StoredEvent) => T): T;
  journalMode(): string;
  synchronous(): number;
  close(): void;
};

type SqlRow = { readonly [key: string]: unknown };

function cell(row: SqlRow, key: string): unknown {
  if (!Object.hasOwn(row, key)) {
    throw new Error(`missing column ${key}`);
  }
  return row[key];
}

function requiredString(row: SqlRow, key: string): string {
  const value = cell(row, key);
  if (typeof value !== "string") {
    throw new Error(`column ${key} is not text`);
  }
  return value;
}

function optionalString(row: SqlRow, key: string): string | null {
  const value = cell(row, key);
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`column ${key} is not text`);
  }
  return value;
}

function requiredInt(row: SqlRow, key: string): number {
  const value = cell(row, key);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`column ${key} is not an integer`);
  }
  return value;
}

function readEvent(row: SqlRow): StoredEvent {
  const runText = requiredString(row, "runId");
  if (!isRunId(runText)) {
    throw new Error("stored run id is invalid");
  }
  const seq = requiredInt(row, "seq");
  return {
    id: eventIdOf(runText, seq),
    runId: runText,
    seq,
    type: requiredString(row, "type"),
    payloadJson: requiredString(row, "payloadJson"),
    causationId: optionalString(row, "causationId"),
    idempotencyKey: optionalString(row, "idempotencyKey"),
  };
}

function isIdempotencyConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes("idempotencyKey")
  );
}

function requirePayload(payloadJson: string): void {
  jsonValue(payloadJson);
}

function validateAppend(input: AppendInput): void {
  if (!isRunId(input.runId)) {
    throw new Error("run id is invalid");
  }
  if (input.type.length === 0) {
    throw new Error("event type is empty");
  }
  requirePayload(input.payloadJson);
  if (input.causationId === "") {
    throw new Error("causation id is empty");
  }
  if (input.idempotencyKey === "") {
    throw new Error("idempotency key is empty");
  }
}

export function defaultEventDbPath(from: string = process.cwd()): string {
  return path.join(from, ".data", "events.sqlite");
}

export function openEventStore(file: string): EventStore {
  if (file !== ":memory:") {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  const journalRow = db.prepare("PRAGMA journal_mode = WAL").get();
  if (journalRow === undefined) {
    throw new Error("missing journal mode");
  }
  const journalMode = requiredString(journalRow, "journal_mode");
  if (journalMode !== "wal") {
    throw new Error(`journal mode ${journalMode} is not wal`);
  }
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  const syncRow = db.prepare("PRAGMA synchronous").get();
  if (syncRow === undefined) {
    throw new Error("missing synchronous pragma");
  }
  const synchronous = requiredInt(syncRow, "synchronous");
  if (synchronous !== 1) {
    throw new Error(`synchronous mode ${synchronous} is not NORMAL`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      runId TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      causationId TEXT,
      idempotencyKey TEXT,
      PRIMARY KEY (runId, seq)
    ) STRICT
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS events_idempotency
    ON events (idempotencyKey)
    WHERE idempotencyKey IS NOT NULL
  `);

  const insertStmt = db.prepare(
    `INSERT INTO events (runId, seq, type, payloadJson, causationId, idempotencyKey)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectKey = db.prepare(
    `SELECT runId, seq, type, payloadJson, causationId, idempotencyKey
     FROM events WHERE idempotencyKey = ?`,
  );
  const selectSeq = db.prepare(
    `SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE runId = ?`,
  );
  const selectRun = db.prepare(
    `SELECT runId, seq, type, payloadJson, causationId, idempotencyKey
     FROM events WHERE runId = ? ORDER BY seq ASC`,
  );
  const countRun = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE runId = ?`);

  let live = true;

  function ensure(): void {
    if (!live) {
      throw new Error("event store is closed");
    }
  }

  function withTransaction<T>(body: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = body();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  function lookupKey(key: string): StoredEvent | undefined {
    const row = selectKey.get(key);
    if (row === undefined) {
      return undefined;
    }
    return readEvent(row);
  }

  function insert(input: AppendInput): StoredEvent {
    return withTransaction(() => {
      if (input.idempotencyKey !== null) {
        const existing = lookupKey(input.idempotencyKey);
        if (existing !== undefined) {
          return existing;
        }
      }
      const seqRow = selectSeq.get(input.runId);
      if (seqRow === undefined) {
        throw new Error("missing seq");
      }
      const seq = requiredInt(seqRow, "seq") + 1;
      insertStmt.run(
        input.runId,
        seq,
        input.type,
        input.payloadJson,
        input.causationId,
        input.idempotencyKey,
      );
      return {
        id: eventIdOf(input.runId, seq),
        runId: input.runId,
        seq,
        type: input.type,
        payloadJson: input.payloadJson,
        causationId: input.causationId,
        idempotencyKey: input.idempotencyKey,
      };
    });
  }

  return {
    append(input) {
      ensure();
      validateAppend(input);
      try {
        return insert(input);
      } catch (error) {
        if (input.idempotencyKey !== null && isIdempotencyConflict(error)) {
          const existing = lookupKey(input.idempotencyKey);
          if (existing !== undefined) {
            return existing;
          }
        }
        throw error;
      }
    },
    list(runId) {
      ensure();
      return selectRun.all(runId).map((row) => readEvent(row));
    },
    count(runId) {
      ensure();
      const row = countRun.get(runId);
      if (row === undefined) {
        throw new Error("missing count");
      }
      return requiredInt(row, "n");
    },
    findByIdempotencyKey(key) {
      ensure();
      return lookupKey(key);
    },
    fold(runId, initial, reduce) {
      ensure();
      let state = initial;
      for (const event of selectRun.all(runId).map((row) => readEvent(row))) {
        state = reduce(state, event);
      }
      return state;
    },
    journalMode() {
      ensure();
      return journalMode;
    },
    synchronous() {
      ensure();
      return synchronous;
    },
    close() {
      if (!live) {
        return;
      }
      live = false;
      if (!db.isOpen) {
        return;
      }
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        if (db.isOpen) {
          db.close();
        }
      }
    },
  };
}
