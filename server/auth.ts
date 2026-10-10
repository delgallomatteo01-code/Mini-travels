import type { AppEnv } from "./types";
import { json, readJson } from "./http";

/**
 * Shared-passphrase access for the two travellers. A successful login sets an
 * HttpOnly, SameSite=Lax cookie signed with HMAC-SHA-256; nothing secret is
 * ever sent to the frontend. The share link alone never grants access.
 */

export const SESSION_COOKIE = "mev_session";
const SESSION_DAYS = 180;
const encoder = new TextEncoder();

export function authDisabled(env: AppEnv) {
  return env.AUTH_DISABLED === "true";
}

function authConfigured(env: AppEnv) {
  return Boolean(env.APP_PASSWORD && env.APP_PASSWORD.length >= 6);
}

async function hmacKey(env: AppEnv) {
  const secret = env.AUTH_SECRET || `me-viaggi:${env.APP_PASSWORD ?? ""}`;
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sign(env: AppEnv, payload: string) {
  return toBase64Url(await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(payload)));
}

export async function createSessionToken(env: AppEnv, now = Date.now()) {
  const expires = String(now + SESSION_DAYS * 86_400_000);
  return `${expires}.${await sign(env, expires)}`;
}

export async function verifySessionToken(env: AppEnv, token: string | null | undefined, now = Date.now()) {
  if (!token || !authConfigured(env)) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < now) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(env), fromBase64Url(signature), encoder.encode(expires));
  } catch {
    return false;
  }
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Constant-time comparison through HMAC digests of equal length. */
async function passwordMatches(env: AppEnv, candidate: string) {
  const key = await hmacKey(env);
  const [a, b] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(`pw:${candidate}`)),
    crypto.subtle.sign("HMAC", key, encoder.encode(`pw:${env.APP_PASSWORD ?? ""}`)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

function sessionCookie(request: Request, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function isAuthenticated(request: Request, env: AppEnv) {
  if (authDisabled(env)) return true;
  return verifySessionToken(env, readCookie(request, SESSION_COOKIE));
}

/** Rejects cross-site writes even when a browser would attach the cookie. */
export function sameOriginWrite(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function handleSession(request: Request, env: AppEnv) {
  return json({
    authenticated: await isAuthenticated(request, env),
    configured: authDisabled(env) || authConfigured(env),
    authDisabled: authDisabled(env),
  });
}

export async function handleLogin(request: Request, env: AppEnv) {
  if (authDisabled(env)) return json({ authenticated: true });
  if (!authConfigured(env)) {
    return json({ error: "Accesso non configurato: imposta APP_PASSWORD (almeno 6 caratteri) sul server." }, 503);
  }
  const payload = await readJson<{ password?: unknown }>(request);
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!password || !(await passwordMatches(env, password))) {
    // A small fixed delay makes online guessing slower without server state.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return json({ error: "Password non corretta" }, 401);
  }
  const token = await createSessionToken(env);
  return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie(request, token, SESSION_DAYS * 86_400) });
}

export function handleLogout(request: Request) {
  return json({ authenticated: false }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
}
