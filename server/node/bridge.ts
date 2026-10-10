import { existsSync, mkdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import type { AppEnv } from "../types";
import { FileSystemBucket } from "./fs-bucket";
import { NodeSqlDatabase } from "./sqlite";

/** Minimal .env reader (KEY=value per line) so no extra dependency is needed. */
export function loadDotEnv(root: string) {
  for (const name of [".env", ".dev.vars"]) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || line.trimStart().startsWith("#")) continue;
      const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
      process.env[match[1]] ??= value;
    }
  }
}

let cached: { key: string; env: AppEnv } | null = null;

/** SQLite file + local folder, both under DATA_DIR (default ./.data). */
export function createNodeEnv(root: string): AppEnv {
  const dataDir = resolve(root, process.env.DATA_DIR || ".data");
  if (cached?.key === dataDir) {
    return { ...cached.env, APP_PASSWORD: process.env.APP_PASSWORD, AUTH_SECRET: process.env.AUTH_SECRET, AUTH_DISABLED: process.env.AUTH_DISABLED };
  }
  mkdirSync(dataDir, { recursive: true });
  const db = new NodeSqlDatabase(resolve(dataDir, "me-viaggi.sqlite"));
  db.applyMigrations(resolve(root, "migrations"));
  const env: AppEnv = {
    DB: db,
    BUCKET: new FileSystemBucket(resolve(dataDir, "files")),
    APP_PASSWORD: process.env.APP_PASSWORD,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_DISABLED: process.env.AUTH_DISABLED,
  };
  cached = { key: dataDir, env };
  return env;
}

export function toWebRequest(req: IncomingMessage, fallbackHost = "localhost") {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const protocol = forwardedProto || ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const url = new URL(req.url ?? "/", `${protocol}://${req.headers.host ?? fallbackHost}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const hasBody = !["GET", "HEAD"].includes(req.method ?? "GET");
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

export async function sendWebResponse(res: ServerResponse, response: Response, method = "GET") {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  if (method === "HEAD" || !response.body) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}
