import { DEFAULT_SITE_SETTINGS } from "../../shared/site-settings";
import { ensureSchema } from "../db";
import { json, storedBodyResponse } from "../http";
import type { AppEnv } from "../types";
import { readSettings } from "./site-settings";

const ASSET_KEYS: Record<string, string> = {
  logo: "site/logo",
  "icon-192": "site/app-icon-192.png",
  "icon-512": "site/app-icon-512.png",
  "traveller-one": "site/traveller-one",
  "traveller-two": "site/traveller-two",
  "memory-one": "site/memory-one",
  "memory-two": "site/memory-two",
  "memory-three": "site/memory-three",
};

const FALLBACKS: Record<string, string> = {
  logo: "/brand-logo.svg",
  "icon-192": "/app-icon-192.png",
  "icon-512": "/app-icon-512.png",
  "traveller-one": "/travel/matteo-avatar.jpeg",
  "traveller-two": "/travel/elena-avatar.jpeg",
  "memory-one": "/travel/matteo-elena-together.jpeg",
  "memory-two": "/travel/matteo-elena-ivy.jpeg",
  "memory-three": "/travel/matteo-elena-florence.jpeg",
};

/** The logo and app icons are needed by the login page and the install manifest. */
export const PUBLIC_ASSET_KINDS = new Set(["logo", "icon-192", "icon-512"]);

export async function getSiteAsset(request: Request, env: AppEnv) {
  const kind = new URL(request.url).searchParams.get("kind") || "";
  const key = ASSET_KEYS[kind];
  if (!key) return new Response("Risorsa non valida", { status: 400 });
  try {
    const object = (await env.BUCKET.get(key))
      // Legacy installations stored the logo as site/logo.svg.
      ?? (kind === "logo" ? await env.BUCKET.get("site/logo.svg") : null);
    if (!object) return Response.redirect(new URL(FALLBACKS[kind], request.url).toString(), 307);
    const response = storedBodyResponse(object, PUBLIC_ASSET_KINDS.has(kind) ? "public, max-age=0, must-revalidate" : "private, max-age=0, must-revalidate");
    if (response.headers.get("Content-Type")?.includes("svg")) {
      response.headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    }
    return response;
  } catch {
    return Response.redirect(new URL(FALLBACKS[kind], request.url).toString(), 307);
  }
}

export async function getManifest(_request: Request, env: AppEnv) {
  let settings = DEFAULT_SITE_SETTINGS;
  try {
    settings = await readSettings(await ensureSchema(env.DB));
  } catch { /* use defaults during first startup */ }

  return json({
    id: "/",
    name: `${settings.appName} — ${settings.appSubtitle}`,
    short_name: settings.appName,
    description: `L’archivio condiviso dei viaggi di ${settings.appSubtitle}.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: settings.backgroundColor,
    theme_color: settings.backgroundColor,
    lang: "it",
    icons: [
      { src: `/api/site-assets?kind=icon-192&v=${settings.logoVersion}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/api/site-assets?kind=icon-512&v=${settings.logoVersion}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/api/site-assets?kind=icon-512&v=${settings.logoVersion}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, 200, { "Content-Type": "application/manifest+json" });
}
