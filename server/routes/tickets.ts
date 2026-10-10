import { errorMessage, json, storedBodyResponse } from "../http";
import type { AppEnv } from "../types";

export const MAX_TICKET_BYTES = 15 * 1024 * 1024;

const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pkpass: "application/vnd.apple.pkpass",
  ics: "text/calendar",
};
const ALLOWED = new Set([...Object.values(EXTENSION_TYPES), "application/ics"]);

/** Browsers often send an empty MIME for .pkpass and .ics: fall back to the extension. */
export function ticketTypeFor(file: File) {
  if (ALLOWED.has(file.type)) return file.type === "application/ics" ? "text/calendar" : file.type;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (!file.type || file.type === "application/octet-stream") return EXTENSION_TYPES[extension] ?? null;
  return null;
}

function contentMatches(bytes: Uint8Array, type: string) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  switch (type) {
    case "application/pdf": return ascii(0, 1024).includes("%PDF-");
    case "image/png": return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    case "image/jpeg": return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/webp": return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "application/vnd.apple.pkpass": return bytes[0] === 0x50 && bytes[1] === 0x4b; // ZIP container
    case "text/calendar": return ascii(0, 64).replace(/^﻿/, "").trimStart().toUpperCase().startsWith("BEGIN:VCALENDAR");
    default: return false;
  }
}

function clean(value: FormDataEntryValue | null) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

export async function uploadTicket(request: Request, env: AppEnv) {
  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const activityId = clean(form?.get("activityId") ?? null);
    const tripId = clean(form?.get("tripId") ?? null);
    const type = file instanceof File ? ticketTypeFor(file) : null;
    if (!(file instanceof File) || !tripId || !activityId || !type || file.size === 0 || file.size > MAX_TICKET_BYTES) {
      return json({ error: "Formato non supportato o file oltre 15 MB (PDF, PNG, JPEG, WebP, PKPASS, ICS)" }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!contentMatches(bytes, type)) return json({ error: "Il contenuto del file non corrisponde al formato" }, 400);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "documento";
    const key = `tickets/${tripId}/${activityId}/${Date.now()}-${safeName}`;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type, contentDisposition: `inline; filename="${safeName}"` } });
    return json({ ticket: { name: file.name.slice(0, 160), key, type } }, 201);
  } catch (error) {
    return json({ error: errorMessage(error, "Caricamento non riuscito") }, 500);
  }
}

export async function getTicket(request: Request, env: AppEnv) {
  try {
    const key = new URL(request.url).searchParams.get("key");
    if (!key?.startsWith("tickets/") || key.includes("..") || key.includes("\\")) return new Response("File non valido", { status: 400 });
    const object = await env.BUCKET.get(key);
    if (!object) return new Response("Documento non trovato in questa installazione", { status: 404 });
    return storedBodyResponse(object, "private, max-age=3600");
  } catch {
    return new Response("Archivio non disponibile", { status: 500 });
  }
}
