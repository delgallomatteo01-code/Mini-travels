import { ensureSchema } from "../db";
import { errorMessage, json, readJson } from "../http";
import type { AppEnv, SqlDatabase } from "../types";
import { readTripState, serializeActivities, tripIdFrom } from "./itinerary";

const MAX_TEXT = 120;
const MAX_URL = 2_048;

type TripRow = {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  image_url: string;
  image_position_y: number;
  image_scale: number;
  created_at: number;
  updated_at: number;
};

const TRIP_COLUMNS = "id, title, destination, start_date, end_date, image_url, image_position_y, image_scale, created_at, updated_at";

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  // Rejects calendar overflow such as 2026-02-31.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validImageUrl(value: string) {
  if (!value || value.length > MAX_URL) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function mapTrip(row: TripRow) {
  return {
    id: row.id,
    title: row.title,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    image: row.image_url,
    imagePositionY: row.image_position_y,
    imageScale: row.image_scale / 100,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type TripFields = {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  image: string;
  imagePositionY: number;
  imageScale: number;
};

function tripFieldsFrom(payload: Record<string, unknown>): TripFields | null {
  const title = cleanText(payload.title);
  const destination = cleanText(payload.destination);
  const startDate = cleanText(payload.startDate);
  const endDate = cleanText(payload.endDate);
  const image = typeof payload.image === "string" ? payload.image.trim() : "";
  const positionInput = Number(payload.imagePositionY ?? 50);
  const scaleInput = Number(payload.imageScale ?? 1);
  const imagePositionY = Math.max(0, Math.min(100, Number.isFinite(positionInput) ? positionInput : 50));
  const imageScale = Math.max(1, Math.min(2, Number.isFinite(scaleInput) ? scaleInput : 1));
  if (!title || !destination || !validDate(startDate) || !validDate(endDate) || endDate < startDate || !validImageUrl(image)) {
    return null;
  }
  return { title, destination, startDate, endDate, image, imagePositionY, imageScale };
}

const INVALID_TRIP = "Completa correttamente nome, destinazione, date (ritorno non prima della partenza) e URL della foto";

export function newTripId(destination: string, startDate: string) {
  const base = destination
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "viaggio";
  return `${base}-${startDate.slice(0, 4)}-${crypto.randomUUID().slice(0, 6)}`;
}

async function insertTrip(db: SqlDatabase, id: string, fields: TripFields, now: number) {
  await db.prepare(
    `INSERT INTO trips (${TRIP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, fields.title, fields.destination, fields.startDate, fields.endDate, fields.image,
    Math.round(fields.imagePositionY), Math.round(fields.imageScale * 100), now, now).run();
  const row = await db.prepare(`SELECT ${TRIP_COLUMNS} FROM trips WHERE id = ?`).bind(id).first<TripRow>();
  return row ? mapTrip(row) : null;
}

export async function listTrips(_request: Request, env: AppEnv) {
  try {
    const db = await ensureSchema(env.DB);
    const result = await db.prepare(`SELECT ${TRIP_COLUMNS} FROM trips ORDER BY start_date ASC, created_at ASC`).all<TripRow>();
    return json({ trips: result.results.map(mapTrip) });
  } catch (error) {
    return json({ error: errorMessage(error, "Impossibile caricare i viaggi") }, 500);
  }
}

export async function createTrip(request: Request, env: AppEnv) {
  try {
    const payload = await readJson<Record<string, unknown>>(request);
    const fields = payload && tripFieldsFrom(payload);
    if (!fields) return json({ error: INVALID_TRIP }, 400);
    const db = await ensureSchema(env.DB);
    const trip = await insertTrip(db, newTripId(fields.destination, fields.startDate), fields, Date.now());
    return json({ trip }, 201);
  } catch (error) {
    return json({ error: errorMessage(error, "Impossibile creare il viaggio") }, 500);
  }
}

export async function updateTrip(request: Request, env: AppEnv) {
  try {
    const payload = await readJson<Record<string, unknown>>(request);
    const id = tripIdFrom(payload?.id);
    const fields = payload && tripFieldsFrom(payload);
    if (!id || !fields) return json({ error: INVALID_TRIP }, 400);

    const db = await ensureSchema(env.DB);
    const result = await db.prepare(
      "UPDATE trips SET title = ?, destination = ?, start_date = ?, end_date = ?, image_url = ?, image_position_y = ?, image_scale = ?, updated_at = ? WHERE id = ?",
    ).bind(fields.title, fields.destination, fields.startDate, fields.endDate, fields.image,
      Math.round(fields.imagePositionY), Math.round(fields.imageScale * 100), Date.now(), id).run();
    if ((result.meta.changes ?? 0) === 0) return json({ error: "Viaggio non trovato" }, 404);

    const row = await db.prepare(`SELECT ${TRIP_COLUMNS} FROM trips WHERE id = ?`).bind(id).first<TripRow>();
    return json({ trip: row ? mapTrip(row) : null });
  } catch (error) {
    return json({ error: errorMessage(error, "Impossibile aggiornare il viaggio") }, 500);
  }
}

/** Deletes one trip, its itinerary and only the files under tickets/<id>/. */
export async function deleteTrip(request: Request, env: AppEnv) {
  try {
    const id = tripIdFrom(new URL(request.url).searchParams.get("id"));
    if (!id) return json({ error: "Viaggio non valido" }, 400);

    const db = await ensureSchema(env.DB);
    const existing = await db.prepare("SELECT id FROM trips WHERE id = ?").bind(id).first<{ id: string }>();
    if (!existing) return json({ error: "Viaggio non trovato" }, 404);

    await db.batch([
      db.prepare("DELETE FROM itinerary_state WHERE id = ?").bind(id),
      db.prepare("DELETE FROM trips WHERE id = ?").bind(id),
    ]);

    let filesCleaned = true;
    try {
      let cursor: string | undefined;
      do {
        const page = await env.BUCKET.list({ prefix: `tickets/${id}/`, cursor, limit: 1_000 });
        if (page.objects.length) await env.BUCKET.delete(page.objects.map((object) => object.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    } catch {
      // The trip is deleted even if an orphaned upload cannot be cleaned up.
      filesCleaned = false;
    }

    return json({ deleted: true, id, filesCleaned });
  } catch (error) {
    return json({ error: errorMessage(error, "Impossibile eliminare il viaggio") }, 500);
  }
}

/**
 * Migration importer: creates ONE trip from an exported { trip, activities }
 * file, keeping the original trip id and every activity field. It never touches
 * other trips and refuses to overwrite an existing id.
 */
export async function importTrip(request: Request, env: AppEnv) {
  try {
    const payload = await readJson<{ trip?: Record<string, unknown>; activities?: unknown; keepId?: unknown }>(request);
    const tripInput = payload?.trip;
    const fields = tripInput && typeof tripInput === "object" ? tripFieldsFrom(tripInput) : null;
    const activitiesJson = serializeActivities(payload?.activities ?? []);
    if (!fields || !activitiesJson) {
      return json({ error: "File non valido: servono { trip, activities } con date, foto e attività corrette" }, 400);
    }
    const db = await ensureSchema(env.DB);
    const requestedId = payload?.keepId === false ? null : tripIdFrom(tripInput?.id);
    let id = requestedId ?? newTripId(fields.destination, fields.startDate);
    if (requestedId && await db.prepare("SELECT id FROM trips WHERE id = ?").bind(requestedId).first()) {
      return json({ error: `Esiste già un viaggio con ID “${requestedId}”. Eliminalo o importa come copia.`, existingId: requestedId }, 409);
    }
    const leftover = await readTripState(db, id);
    if (leftover.activities) id = newTripId(fields.destination, fields.startDate);

    const now = Date.now();
    await db.batch([
      db.prepare(`INSERT INTO trips (${TRIP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, fields.title, fields.destination, fields.startDate, fields.endDate, fields.image,
          Math.round(fields.imagePositionY), Math.round(fields.imageScale * 100), now, now),
      db.prepare("INSERT INTO itinerary_state (id, activities_json, version, updated_at) VALUES (?, ?, 1, ?)")
        .bind(id, activitiesJson, now),
    ]);
    const row = await db.prepare(`SELECT ${TRIP_COLUMNS} FROM trips WHERE id = ?`).bind(id).first<TripRow>();
    const activities = JSON.parse(activitiesJson) as Array<{ ticket?: unknown }>;
    return json({
      trip: row ? mapTrip(row) : null,
      activities: activities.length,
      ticketReferences: activities.filter((activity) => activity.ticket).length,
    }, 201);
  } catch (error) {
    return json({ error: errorMessage(error, "Importazione non riuscita") }, 500);
  }
}
