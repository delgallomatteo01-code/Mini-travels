import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlStatement, SqlValue } from "../types";

/** D1-compatible facade over Node's built-in SQLite (node:sqlite). */
export class NodeSqlDatabase implements SqlDatabase {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  }

  prepare(query: string): SqlStatement {
    return new NodeStatement(this.raw, query, []);
  }

  async batch(statements: SqlStatement[]) {
    this.raw.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  /** Applies migrations/*.sql once each, in name order. */
  applyMigrations(directory: string) {
    this.raw.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)");
    const applied = new Set((this.raw.prepare("SELECT name FROM _migrations").all() as Array<{ name: string }>).map((row) => row.name));
    const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      if (applied.has(name)) continue;
      this.raw.exec("BEGIN");
      try {
        this.raw.exec(readFileSync(join(directory, name), "utf8"));
        this.raw.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(name, Date.now());
        this.raw.exec("COMMIT");
      } catch (error) {
        this.raw.exec("ROLLBACK");
        throw error;
      }
    }
  }
}

class NodeStatement implements SqlStatement {
  constructor(private readonly db: DatabaseSync, private readonly query: string, private readonly values: SqlValue[]) {}

  bind(...values: SqlValue[]) {
    return new NodeStatement(this.db, this.query, values);
  }

  async first<T>() {
    return (this.db.prepare(this.query).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.query).all(...this.values) as T[] };
  }

  async run() {
    const result = this.db.prepare(this.query).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}
