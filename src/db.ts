import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";

export type JobStatus = "pending" | "cancelled" | "running" | "done" | "failed";

export interface Job {
  id: number;
  server: string;
  status: JobStatus;
  run_at: number;
  created_at: number;
  message_id: number | null;
  reminded: number;
  result: string | null;
}

mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new Database(config.dbPath, { create: true, strict: true });
db.run("PRAGMA journal_mode = WAL");
db.run(`
  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    server      TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending',
    run_at      INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    message_id  INTEGER,
    reminded    INTEGER NOT NULL DEFAULT 0,
    result      TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS weekly_runs (
    occurrence  INTEGER PRIMARY KEY,
    created_at  INTEGER NOT NULL
  )
`);

/** Records a weekly trigger; false means this occurrence was already started (e.g. before a restart). */
export function claimWeeklyRun(occurrence: number): boolean {
  return (
    db.query("INSERT OR IGNORE INTO weekly_runs (occurrence, created_at) VALUES (?, ?)").run(occurrence, Date.now())
      .changes === 1
  );
}

export function createJob(server: string, delayMinutes: number): Job {
  const now = Date.now();
  return db
    .query<Job, { server: string; run_at: number; created_at: number }>(
      "INSERT INTO jobs (server, run_at, created_at) VALUES ($server, $run_at, $created_at) RETURNING *",
    )
    .get({ server, run_at: now + delayMinutes * 60_000, created_at: now })!;
}

export function getJob(id: number): Job | null {
  return db.query<Job, [number]>("SELECT * FROM jobs WHERE id = ?").get(id);
}

export function listJobs(limit = 20): Job[] {
  return db.query<Job, [number]>("SELECT * FROM jobs ORDER BY id DESC LIMIT ?").all(limit);
}

export function pendingJobs(): Job[] {
  return db.query<Job, []>("SELECT * FROM jobs WHERE status = 'pending' ORDER BY run_at").all();
}

/** Returns true only if the job was still pending, so a cancel can never race a running deletion. */
export function cancelJob(id: number): boolean {
  return db.query("UPDATE jobs SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id).changes === 1;
}

/** Atomically moves a due job from pending to running; false means it was cancelled meanwhile. */
export function claimJob(id: number): boolean {
  return (
    db
      .query("UPDATE jobs SET status = 'running' WHERE id = ? AND status = 'pending' AND run_at <= ?")
      .run(id, Date.now()).changes === 1
  );
}

export function finishJob(id: number, status: "done" | "failed", result: string): void {
  db.query("UPDATE jobs SET status = ?, result = ? WHERE id = ?").run(status, result, id);
}

export function setMessageId(id: number, messageId: number): void {
  db.query("UPDATE jobs SET message_id = ? WHERE id = ?").run(messageId, id);
}

export function markReminded(id: number): void {
  db.query("UPDATE jobs SET reminded = 1 WHERE id = ?").run(id);
}

export function postpone(id: number, runAt: number): void {
  db.query("UPDATE jobs SET run_at = ? WHERE id = ? AND status = 'pending'").run(runAt, id);
}

/** Jobs left in 'running' by a crash are never retried automatically. */
export function failInterruptedJobs(): Job[] {
  return db
    .query<Job, []>(
      "UPDATE jobs SET status = 'failed', result = 'interrupted by restart - check the server manually' WHERE status = 'running' RETURNING *",
    )
    .all();
}
