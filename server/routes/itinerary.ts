import { ensureSchema } from "../db";
import { errorMessage, json, readJson } from "../http";
import type { AppEnv, SqlDatabase } from "../types";

export const MAX_ACTIVITIES = 500;
const MAX_PAYLOAD_BYTES = 1_000_000;

type ItineraryRow = {
  activities_json: string;
  version: number;
  updated_at: number;
};

/**
 * Validates the minimum shape and returns the serialized array. The array is
 * stored exactly as sent: order, dayId and every user field are authoritative.
 */
export function serializeActivities(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_ACTIVITIES) return null;
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const activity = item as Record<string, unknown>;
    if (typeof activity.id !== "string" || !activity.id
      || typeof activity.dayId !== "string" || !activity.dayId
      || typeof activity.time !== "string"
      || typeof activity.title !== "string") return null;
    if (ids.has(activity.id)) return null;
    ids.add(activity.id);
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) return null;
  return serialized;
}

export function tripIdFrom(value: unknown) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(id) ? id : null;
}

export async function readTripState(db: SqlDatabase, tripId: string) {
  const row = await db.prepare(
    "SELECT activities_json, version, updated_at FROM itinerary_state WHERE id = ?",
  ).bind(tripId).first<ItineraryRow>();

  if (!row) return { activities: null, version: 0, updatedAt: null };
  return {
    activities: JSON.parse(row.activities_json) as unknown[],
    version: row.version,
    updatedAt: row.updated_at,
  };
}

async function tripExists(db: SqlDatabase, tripId: string) {
  return Boolean(await db.prepare("SELECT id FROM trips WHERE id = ?").bind(tripId).first());
}

export async function getItinerary(request: Request, env: AppEnv) {
  try {
    const tripId = tripIdFrom(new URL(request.url).searchParams.get("tripId"));
    if (!tripId) return json({ error: "Viaggio non valido" }, 400);
    const db = await ensureSchema(env.DB);
    return json(await readTripState(db, tripId));
  } catch (error) {
    return json({ error: errorMessage(error, "Errore di sincronizzazione") }, 500);
  }
}

/**
 * Optimistic concurrency: the client sends the version it last saw. A stale
 * version returns 409 with the current server state so the client can let the
 * user decide, instead of silently overwriting the other device.
 */
export async function putItinerary(request: Request, env: AppEnv) {
  try {
    const payload = await readJson<{ activities?: unknown; version?: unknown; tripId?: unknown }>(request);
    const tripId = tripIdFrom(payload?.tripId);
    const activitiesJson = serializeActivities(payload?.activities);
    const expectedVersion = Number(payload?.version);

    if (!payload || !tripId || !activitiesJson || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return json({ error: "Dati dell’itinerario non validi" }, 400);
    }

    const db = await ensureSchema(env.DB);
    if (!(await tripExists(db, tripId))) return json({ error: "Viaggio non trovato" }, 404);
    const updatedAt = Date.now();

    if (expectedVersion === 0) {
      const inserted = await db.prepare(
        "INSERT OR IGNORE INTO itinerary_state (id, activities_json, version, updated_at) VALUES (?, ?, 1, ?)",
      ).bind(tripId, activitiesJson, updatedAt).run();

      if ((inserted.meta.changes ?? 0) > 0) {
        return json({ activities: payload.activities, version: 1, updatedAt }, 201);
      }
    } else {
      const updated = await db.prepare(
        "UPDATE itinerary_state SET activities_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      ).bind(activitiesJson, updatedAt, tripId, expectedVersion).run();

      if ((updated.meta.changes ?? 0) > 0) {
        return json({ activities: payload.activities, version: expectedVersion + 1, updatedAt });
      }
    }

    return json({ ...(await readTripState(db, tripId)), conflict: true }, 409);
  } catch (error) {
    return json({ error: errorMessage(error, "Errore di sincronizzazione") }, 500);
  }
}
