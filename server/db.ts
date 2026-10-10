import type { SqlDatabase } from "./types";

/**
 * The same statements live in migrations/0001_init.sql. Keeping them here as
 * CREATE TABLE IF NOT EXISTS makes a fresh database usable even before the
 * migration command has been run, without ever altering existing data.
 */
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS itinerary_state (
    id TEXT PRIMARY KEY NOT NULL,
    activities_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    destination TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    image_url TEXT NOT NULL,
    image_position_y INTEGER NOT NULL DEFAULT 50,
    image_scale INTEGER NOT NULL DEFAULT 100,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_settings (
    id TEXT PRIMARY KEY NOT NULL,
    settings_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

const ensured = new WeakSet<SqlDatabase>();

export async function ensureSchema(db: SqlDatabase) {
  if (ensured.has(db)) return db;
  for (const statement of SCHEMA_STATEMENTS) await db.prepare(statement).run();
  ensured.add(db);
  return db;
}
