import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeActivities } from "./activities";
import { api, ApiError } from "./api";
import type { Activity, SyncState } from "./types";

/**
 * Shared itinerary of one trip, with the database as source of truth.
 *
 * - Every write sends the version last seen; the server answers 409 when
 *   another device saved first. The remote version is then shown and the
 *   local edit is kept aside (also in localStorage) until the user decides.
 * - Edits that could not be sent stay in this browser's localStorage marked
 *   as "dirty" and are retried on reconnect, focus and every poll. They are
 *   NOT shared until the server confirms them: the badge says so.
 * - Responses for a trip that is no longer open are ignored, so switching
 *   trip while a request is pending cannot mix versions or activities.
 */

const POLL_MS = 8_000;

type CacheRecord = { activities: Activity[]; version: number; dirty: boolean };
export type ConflictRecord = { activities: Activity[]; remoteVersion: number; at: number };

const cacheKey = (tripId: string) => `${tripId}-itinerary-v2`;
const conflictKey = (tripId: string) => `${tripId}-conflict-v1`;

function readStorage<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full or blocked: the server stays authoritative */ }
}

function readCache(tripId: string): CacheRecord | null {
  const record = readStorage<CacheRecord>(cacheKey(tripId));
  const activities = normalizeActivities(record?.activities);
  if (!record || !activities || !Number.isInteger(record.version)) return null;
  return { activities, version: record.version, dirty: Boolean(record.dirty) };
}

function readConflict(tripId: string): ConflictRecord | null {
  const record = readStorage<ConflictRecord>(conflictKey(tripId));
  const activities = normalizeActivities(record?.activities);
  return record && activities ? { ...record, activities } : null;
}

type ServerState = { activities: unknown; version: number };

export function useItinerarySync(tripId: string | null, notify: (message: string) => void) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [conflict, setConflict] = useState<ConflictRecord | null>(null);
  const [lastError, setLastError] = useState("");
  /** Increments whenever the remote state replaces the local one (clears undo). */
  const [remoteRevision, setRemoteRevision] = useState(0);

  const ref = useRef({
    tripId: null as string | null,
    generation: 0,
    version: 0,
    pending: null as Activity[] | null,
    inFlight: false,
    hydrated: false,
  });
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const applyRemote = useCallback((tripIdValue: string, state: ServerState) => {
    const remote = normalizeActivities(state.activities) ?? [];
    ref.current.version = state.version;
    setActivities(remote);
    writeStorage(cacheKey(tripIdValue), { activities: remote, version: state.version, dirty: false });
    setRemoteRevision((value) => value + 1);
    return remote;
  }, []);

  const storeConflict = useCallback((tripIdValue: string, local: Activity[], remoteVersion: number) => {
    const record = { activities: local, remoteVersion, at: Date.now() };
    writeStorage(conflictKey(tripIdValue), record);
    setConflict(record);
  }, []);

  const flush = useCallback(async () => {
    const state = ref.current;
    const tripIdValue = state.tripId;
    if (!tripIdValue || state.inFlight || !state.pending || !state.hydrated) return;
    const generation = state.generation;
    state.inFlight = true;
    setSyncState("saving");
    try {
      while (state.pending) {
        const snapshot = state.pending;
        state.pending = null;
        let result;
        try {
          result = await api<ServerState & { error?: string }>("/api/itinerary", {
            method: "PUT",
            body: JSON.stringify({ tripId: tripIdValue, activities: snapshot, version: state.version }),
          });
        } catch (error) {
          if (generation !== state.generation) return;
          state.pending = state.pending ?? snapshot;
          writeStorage(cacheKey(tripIdValue), { activities: state.pending, version: state.version, dirty: true });
          setLastError(error instanceof ApiError ? error.message : "Connessione non disponibile");
          setSyncState("offline");
          return;
        }
        if (generation !== state.generation) return;

        if (result.status === 409) {
          const latestLocal = state.pending ?? snapshot;
          state.pending = null;
          applyRemote(tripIdValue, result.data);
          storeConflict(tripIdValue, latestLocal, result.data.version);
          notifyRef.current("Modifica contemporanea: caricata la versione più recente, la tua è conservata");
          break;
        }

        state.version = result.data.version;
        writeStorage(cacheKey(tripIdValue), {
          activities: state.pending ?? snapshot,
          version: state.version,
          dirty: Boolean(state.pending),
        });
      }
      setLastError("");
      setSyncState("synced");
    } finally {
      if (generation === state.generation) state.inFlight = false;
    }
  }, [applyRemote, storeConflict]);

  /** Initial load and periodic refresh share this path. */
  const refresh = useCallback(async (initial = false) => {
    const state = ref.current;
    const tripIdValue = state.tripId;
    if (!tripIdValue) return;
    if (state.inFlight) return;
    if (state.pending && state.hydrated) {
      void flush();
      return;
    }
    const generation = state.generation;
    try {
      const { data } = await api<ServerState>(`/api/itinerary?tripId=${encodeURIComponent(tripIdValue)}`);
      if (generation !== state.generation || state.inFlight) return;
      const cache = readCache(tripIdValue);
      if (!state.hydrated) {
        state.hydrated = true;
        setHydrated(true);
        if (cache?.dirty) {
          if (data.version === cache.version) {
            // Unsent edits made on top of the current server version: resend them.
            state.version = cache.version;
            state.pending = cache.activities;
            setActivities(cache.activities);
            setSyncState("saving");
            void flush();
            return;
          }
          applyRemote(tripIdValue, data);
          storeConflict(tripIdValue, cache.activities, data.version);
          notifyRef.current("Nel frattempo l’itinerario è cambiato: la tua versione non inviata è conservata");
        } else {
          applyRemote(tripIdValue, data);
        }
      } else if (data.version > state.version) {
        applyRemote(tripIdValue, data);
        if (!initial) notifyRef.current("Itinerario aggiornato da un altro dispositivo");
      }
      setLastError("");
      setSyncState("synced");
    } catch (error) {
      if (generation !== state.generation) return;
      setLastError(error instanceof ApiError ? error.message : "Connessione non disponibile");
      setSyncState("offline");
    }
  }, [applyRemote, flush, storeConflict]);

  useEffect(() => {
    const state = ref.current;
    state.generation += 1;
    state.tripId = tripId;
    state.version = 0;
    state.pending = null;
    state.inFlight = false;
    state.hydrated = false;
    setHydrated(false);
    setConflict(null);
    setLastError("");
    setRemoteRevision((value) => value + 1);
    if (!tripId) {
      setActivities([]);
      setSyncState("synced");
      return;
    }
    setSyncState("loading");
    const cache = readCache(tripId);
    if (cache) {
      // Show the last known state immediately; it is replaced by the server.
      setActivities(cache.activities);
      state.version = cache.version;
    } else {
      setActivities([]);
    }
    setConflict(readConflict(tripId));
    void refresh(true).then(() => {
      // Offline at startup with a usable cache: allow viewing and local edits.
      if (!state.hydrated && state.tripId === tripId && cache) {
        state.hydrated = true;
        setHydrated(true);
        if (cache.dirty) state.pending = cache.activities;
      }
    });

    const interval = window.setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tripId, refresh]);

  /** Applies a local change immediately and sends it to the server. */
  const save = useCallback((next: Activity[]) => {
    const state = ref.current;
    if (!state.tripId || !state.hydrated) return false;
    setActivities(next);
    state.pending = next;
    writeStorage(cacheKey(state.tripId), { activities: next, version: state.version, dirty: true });
    void flush();
    return true;
  }, [flush]);

  /** "mine" re-applies the kept local version on top of the newest remote one. */
  const resolveConflict = useCallback((choice: "mine" | "theirs") => {
    const state = ref.current;
    if (!state.tripId) return;
    const kept = conflict?.activities;
    writeStorage(conflictKey(state.tripId), null);
    setConflict(null);
    if (choice === "mine" && kept) save(kept);
  }, [conflict, save]);

  return { activities, hydrated, syncState, conflict, lastError, remoteRevision, save, resolveConflict, retry: () => void refresh() };
}
