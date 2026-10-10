import { ASSET_VERSION_KEYS, DEFAULT_SITE_SETTINGS, mergeSiteSettings, type SiteAssetKind, type SiteSettings } from "../../shared/site-settings";
import { ensureSchema } from "../db";
import { errorMessage, json, readJson } from "../http";
import type { AppEnv, SqlDatabase } from "../types";

const SETTINGS_ID = "main";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_SVG_BYTES = 1024 * 1024;
const TEXT_KEYS = [
  "appName", "appSubtitle", "travellerOneName", "travellerTwoName",
  "memoryOneCaption", "memoryTwoCaption", "memoryThreeCaption",
] as const;
const COLOR_KEYS = ["accentColor", "secondaryAccentColor", "backgroundColor", "cardColor", "textColor", "mutedColor"] as const;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export async function readSettings(db: SqlDatabase) {
  const row = await db.prepare("SELECT settings_json FROM site_settings WHERE id = ?").bind(SETTINGS_ID).first<{ settings_json: string }>();
  if (!row) return DEFAULT_SITE_SETTINGS;
  try { return mergeSiteSettings(JSON.parse(row.settings_json)); }
  catch { return DEFAULT_SITE_SETTINGS; }
}

async function writeSettings(db: SqlDatabase, settings: SiteSettings) {
  await db.prepare(
    "INSERT INTO site_settings (id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at",
  ).bind(SETTINGS_ID, JSON.stringify(settings), Date.now()).run();
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function safeText(value: unknown, fallback: string, max = 80) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, max) || fallback;
}

export function hasPngSignature(bytes: ArrayBuffer) {
  const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  return signature.length === 8 && PNG_SIGNATURE.every((byte, index) => signature[index] === byte);
}

function hasImageSignature(bytes: ArrayBuffer, type: string) {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
  if (type === "image/png") return hasPngSignature(bytes);
  if (type === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (type === "image/webp") return String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP";
  return false;
}

/** Accepts plain vector logos only: no scripts, handlers, embeds or external references. */
export function isSafeSvg(svg: string) {
  if (!/<svg[\s>]/i.test(svg)) return false;
  const unsafe = [
    /<script[\s>/]/i,
    /\son\w+\s*=/i,
    /javascript:/i,
    /<foreignObject[\s>/]/i,
    /<!ENTITY/i,
    /<(iframe|embed|object)[\s>/]/i,
    /(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|data:text)/i,
    /@import/i,
  ];
  return !unsafe.some((pattern) => pattern.test(svg));
}

export async function getSettings(_request: Request, env: AppEnv) {
  try { return json({ settings: await readSettings(await ensureSchema(env.DB)) }); }
  catch (error) { return json({ error: errorMessage(error, "Impostazioni non disponibili") }, 500); }
}

export async function putSettings(request: Request, env: AppEnv) {
  try {
    const payload = await readJson<Partial<SiteSettings>>(request);
    if (!payload) return json({ error: "Impostazioni non valide" }, 400);
    const db = await ensureSchema(env.DB);
    const current = await readSettings(db);
    const next = { ...current };
    for (const key of TEXT_KEYS) next[key] = safeText(payload[key], current[key], key === "appName" ? 42 : 80);
    for (const key of COLOR_KEYS) if (isHex(payload[key])) next[key] = payload[key];
    await writeSettings(db, next);
    return json({ settings: next });
  } catch (error) {
    return json({ error: errorMessage(error, "Impossibile salvare le impostazioni") }, 500);
  }
}

export async function uploadSiteAsset(request: Request, env: AppEnv) {
  try {
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: "Richiesta non valida" }, 400);
    const kind = String(form.get("kind") || "") as SiteAssetKind;
    const file = form.get("file");
    if (!Object.prototype.hasOwnProperty.call(ASSET_VERSION_KEYS, kind) || !(file instanceof File)) return json({ error: "File non valido" }, 400);

    if (kind === "logo") {
      const lowerName = file.name.toLowerCase();
      const isSvg = file.type === "image/svg+xml" || lowerName.endsWith(".svg");
      const isPng = !isSvg && (file.type === "image/png" || lowerName.endsWith(".png"));
      const icon192 = form.get("icon192");
      const icon512 = form.get("icon512");
      if ((!isSvg && !isPng) || file.size > (isSvg ? MAX_SVG_BYTES : MAX_IMAGE_BYTES)
        || !(icon192 instanceof File) || !(icon512 instanceof File)
        || icon192.size > MAX_IMAGE_BYTES || icon512.size > MAX_IMAGE_BYTES) {
        return json({ error: "Usa un SVG entro 1 MB o un PNG entro 8 MB, con icone PNG valide" }, 400);
      }
      const [icon192Bytes, icon512Bytes] = await Promise.all([icon192.arrayBuffer(), icon512.arrayBuffer()]);
      if (!hasPngSignature(icon192Bytes) || !hasPngSignature(icon512Bytes)) {
        return json({ error: "Le icone dell’app devono essere PNG validi" }, 400);
      }
      let logo: string | ArrayBuffer;
      let contentType: string;
      if (isSvg) {
        const svg = await file.text();
        if (!isSafeSvg(svg)) return json({ error: "L’SVG contiene elementi non sicuri" }, 400);
        logo = svg;
        contentType = "image/svg+xml";
      } else {
        const bytes = await file.arrayBuffer();
        if (!hasPngSignature(bytes)) return json({ error: "Il file non è un PNG valido" }, 400);
        // Keep the original PNG bytes, including alpha transparency.
        logo = bytes;
        contentType = "image/png";
      }
      await Promise.all([
        env.BUCKET.put("site/logo", logo, { httpMetadata: { contentType } }),
        env.BUCKET.put("site/app-icon-192.png", icon192Bytes, { httpMetadata: { contentType: "image/png" } }),
        env.BUCKET.put("site/app-icon-512.png", icon512Bytes, { httpMetadata: { contentType: "image/png" } }),
      ]);
    } else {
      if (!PHOTO_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) return json({ error: "Usa JPG, PNG o WebP entro 8 MB" }, 400);
      const bytes = await file.arrayBuffer();
      if (!hasImageSignature(bytes, file.type)) return json({ error: "Il contenuto del file non corrisponde al formato dichiarato" }, 400);
      await env.BUCKET.put(`site/${kind}`, bytes, { httpMetadata: { contentType: file.type } });
    }

    const db = await ensureSchema(env.DB);
    const current = await readSettings(db);
    const next = { ...current, [ASSET_VERSION_KEYS[kind]]: Date.now() } as SiteSettings;
    await writeSettings(db, next);
    return json({ settings: next });
  } catch (error) {
    return json({ error: errorMessage(error, "Caricamento non riuscito") }, 500);
  }
}
