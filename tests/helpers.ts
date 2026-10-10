import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApiRequest } from "../server/app";
import { FileSystemBucket } from "../server/node/fs-bucket";
import { NodeSqlDatabase } from "../server/node/sqlite";
import type { AppEnv } from "../server/types";

/** Fresh in-memory database + temporary file folder, migrations applied. */
export function createTestEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  const db = new NodeSqlDatabase(":memory:");
  db.applyMigrations(new URL("../migrations", import.meta.url).pathname);
  return {
    DB: db,
    BUCKET: new FileSystemBucket(mkdtempSync(join(tmpdir(), "me-viaggi-test-"))),
    APP_PASSWORD: "password-di-prova",
    ...overrides,
  };
}

/** Small client that keeps the session cookie like a browser would. */
export function createClient(env: AppEnv, base = "https://viaggi.example") {
  let cookie = "";
  async function call(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("Cookie", cookie);
    if (typeof init.body === "string") headers.set("Content-Type", "application/json");
    const response = await handleApiRequest(new Request(`${base}${path}`, { ...init, headers }), env);
    const setCookie = response.headers.get("Set-Cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return response;
  }
  return {
    call,
    async json<T = Record<string, unknown>>(path: string, init: RequestInit = {}) {
      const response = await call(path, init);
      return { status: response.status, data: await response.json() as T };
    },
    async login(password = env.APP_PASSWORD ?? "") {
      return call("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    },
  };
}

export const SAMPLE_TRIP = {
  title: "PARIGI 2026",
  destination: "Parigi, Francia",
  startDate: "2026-09-11",
  endDate: "2026-09-18",
  image: "https://images.example/paris.jpg",
  imagePositionY: 50,
  imageScale: 1,
};
