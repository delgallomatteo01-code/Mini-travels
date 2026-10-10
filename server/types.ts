/**
 * Minimal storage contracts shared by the Cloudflare runtime (D1 + R2) and the
 * Node runtime (SQLite + local folder). Only the subset used by the API is
 * declared, so both adapters stay small and testable.
 */

export type SqlValue = string | number | null;

export interface SqlRunResult {
  meta: { changes?: number };
}

export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<SqlRunResult>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  /** Executes the statements atomically. */
  batch(statements: SqlStatement[]): Promise<unknown>;
}

export interface StoredObject {
  body: ReadableStream | ArrayBuffer | Uint8Array | string;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

export interface PutOptions {
  httpMetadata?: { contentType?: string; contentDisposition?: string };
}

export interface ObjectStore {
  put(key: string, value: ReadableStream | ArrayBuffer | Uint8Array | string | Blob, options?: PutOptions): Promise<unknown>;
  get(key: string): Promise<StoredObject | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface AppEnv {
  DB: SqlDatabase;
  BUCKET: ObjectStore;
  /** Shared passphrase required to read or change data. */
  APP_PASSWORD?: string;
  /** Optional HMAC key for session cookies; defaults to a key derived from APP_PASSWORD. */
  AUTH_SECRET?: string;
  /** "true" disables the login (only for local development or tests). */
  AUTH_DISABLED?: string;
}
