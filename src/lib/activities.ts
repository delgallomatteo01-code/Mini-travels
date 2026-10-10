import { CATEGORIES, PARIS_DAYS, PARIS_TRIP, STATUSES } from "./data";
import { PLANNING_DAY_ID, type Activity, type Category, type Day, type Status, type Trip } from "./types";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(time: string) {
  return TIME_PATTERN.test(time);
}

/** Minutes after midnight; invalid times sort last instead of producing NaN. */
export function minutes(time: string) {
  if (!isValidTime(time)) return 24 * 60;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function formatDuration(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m} min`;
}

export function formatEuro(value: number) {
  return `€ ${value.toFixed(2).replace(".00", "").replace(".", ",")}`;
}

/** Civil dates are handled at UTC noon so no time zone can shift the day. */
export function dateAtNoon(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

/** Today's civil date (YYYY-MM-DD) in the device's own time zone. */
export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTripDate(value: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) {
  return new Intl.DateTimeFormat("it-IT", { ...options, timeZone: "UTC" }).format(dateAtNoon(value));
}

export function formatTripRange(trip: Pick<Trip, "startDate" | "endDate">) {
  const start = formatTripDate(trip.startDate, { day: "numeric", month: "short" });
  const end = formatTripDate(trip.endDate, { day: "numeric", month: "short", year: "numeric" });
  return `${start} – ${end}`;
}

export function tripDayCount(trip: Pick<Trip, "startDate" | "endDate">) {
  return Math.max(1, Math.round((dateAtNoon(trip.endDate).getTime() - dateAtNoon(trip.startDate).getTime()) / 86_400_000) + 1);
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * One Day per civil date of the trip. Generic ids are "day-YYYY-MM-DD"; the
 * example Paris trip keeps its historical ids (sep11…sep18) and themes for the
 * dates they belong to, so saved activities keep pointing at the right day.
 */
export function generateTripDays(trip: Trip): Day[] {
  const start = dateAtNoon(trip.startDate);
  const count = tripDayCount(trip);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    const legacy = trip.id === PARIS_TRIP.id ? PARIS_DAYS.find((day) => day.date === key) : undefined;
    if (legacy) return legacy;
    const weekday = new Intl.DateTimeFormat("it-IT", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "");
    const dayNumber = new Intl.DateTimeFormat("it-IT", { day: "numeric", timeZone: "UTC" }).format(date);
    return {
      id: `day-${key}`,
      date: key,
      tab: `${capitalize(weekday)} ${dayNumber}`,
      full: capitalize(formatTripDate(key, { weekday: "long", day: "numeric", month: "long" })),
      theme: index === 0 ? "Arrivo e prime tappe" : index === count - 1 ? "Ritorno" : "Giornata da pianificare",
    };
  });
}

export function tripTiming(trip: Pick<Trip, "startDate" | "endDate">, today = localDateKey()) {
  if (today < trip.startDate) return "upcoming";
  if (today > trip.endDate) return "past";
  return "current";
}

export function daysUntil(dateKey: string, today: string) {
  return Math.max(0, Math.round((dateAtNoon(dateKey).getTime() - dateAtNoon(today).getTime()) / 86_400_000));
}

export function normalizeImageUrl(value?: string) {
  const cleaned = value?.trim().replace(/^["']|["']$/g, "");
  if (!cleaned) return undefined;
  if (cleaned.startsWith("//")) return `https:${cleaned}`;
  if (/^www\./i.test(cleaned)) return `https://${cleaned}`;
  return cleaned;
}

/**
 * Loader used for server responses and the local cache. Saved scheduling and
 * content are authoritative: this NEVER moves an activity to a default day or
 * restores a default title/note based on its id. Initial trip data belongs
 * only to the explicit "create example trip" action.
 */
export function normalizeActivities(value: unknown): Activity[] | null {
  if (!Array.isArray(value)) return null;
  const valid = value.every((item) => item
    && typeof item === "object"
    && typeof item.id === "string"
    && typeof item.dayId === "string"
    && typeof item.time === "string"
    && typeof item.title === "string");
  if (!valid) return null;

  return (value as Activity[]).map((activity) => ({
    ...activity,
    image: normalizeImageUrl(activity.image),
  }));
}

function finiteNumber(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalString(value: unknown, max = 2_000) {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : undefined;
}

/**
 * Validation for files chosen by the user ("Importa JSON"). Unlike the reload
 * path it fills missing required fields with neutral values, keeps every
 * provided value (including dayId, order and tickets) and rejects duplicates.
 */
export function sanitizeImportedActivities(value: unknown): Activity[] {
  const list = Array.isArray(value) ? value : (value && typeof value === "object" ? (value as { activities?: unknown }).activities : null);
  if (!Array.isArray(list)) throw new Error("Il file deve contenere { trip, activities } oppure un elenco di attività");
  if (list.length > 500) throw new Error("Troppe attività (massimo 500)");
  const seen = new Set<string>();
  return list.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Attività ${index + 1} non valida`);
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
    const dayId = typeof item.dayId === "string" && item.dayId.trim() ? item.dayId.trim() : "";
    const title = typeof item.title === "string" ? item.title : "";
    if (!id || !dayId || !title.trim()) throw new Error(`Attività ${index + 1}: servono id, dayId e titolo`);
    if (seen.has(id)) throw new Error(`ID duplicato: ${id}`);
    seen.add(id);
    const time = typeof item.time === "string" && isValidTime(item.time) ? item.time : "10:00";
    const ticket = item.ticket && typeof item.ticket === "object"
      && typeof (item.ticket as Record<string, unknown>).key === "string"
      && typeof (item.ticket as Record<string, unknown>).name === "string"
      && typeof (item.ticket as Record<string, unknown>).type === "string"
      ? item.ticket as Activity["ticket"] : undefined;
    const activity: Activity = {
      ...(item as Partial<Activity>),
      id,
      dayId,
      time,
      title: title.slice(0, 200),
      category: CATEGORIES.includes(item.category as Category) ? item.category as Category : "Attrazione",
      status: STATUSES.includes(item.status as Status) ? item.status as Status : "Da prenotare",
      duration: Math.max(0, Math.round(finiteNumber(item.duration, 60))),
      area: typeof item.area === "string" ? item.area.slice(0, 200) : "",
      cost: Math.max(0, finiteNumber(item.cost, 0)),
      image: normalizeImageUrl(optionalString(item.image)),
      ticket,
    };
    if (item.totalCost === undefined || item.totalCost === null || item.totalCost === "") delete activity.totalCost;
    else activity.totalCost = Math.max(0, finiteNumber(item.totalCost, 0));
    if (!ticket) delete activity.ticket;
    if (!activity.image) delete activity.image;
    return activity;
  });
}

/** Activities that sit on an actual day of the trip (not planning, not orphaned). */
export function scheduledActivities(activities: Activity[], days: Day[]) {
  const ids = new Set(days.map((day) => day.id));
  return activities.filter((activity) => ids.has(activity.dayId));
}

/** Planning list plus activities whose day no longer exists after a date change. */
export function unscheduledActivities(activities: Activity[], days: Day[]) {
  const ids = new Set(days.map((day) => day.id));
  return activities.filter((activity) => !ids.has(activity.dayId));
}

export function isOrphan(activity: Activity, days: Day[]) {
  return activity.dayId !== PLANNING_DAY_ID && !days.some((day) => day.id === activity.dayId);
}

export function coupleCost(activity: Activity) {
  // An explicit totalCost of 0 is valid and must not fall back to cost * 2.
  return typeof activity.totalCost === "number" && Number.isFinite(activity.totalCost) ? activity.totalCost : activity.cost * 2;
}

export function costTotals(activities: Activity[], days: Day[]) {
  const planned = scheduledActivities(activities, days);
  return {
    perPerson: planned.reduce((sum, activity) => sum + (Number.isFinite(activity.cost) ? activity.cost : 0), 0),
    couple: planned.reduce((sum, activity) => sum + coupleCost(activity), 0),
  };
}

export const CONFIRMED_STATUSES: Status[] = ["Prenotato", "Pagato", "Confermato", "Gratuito"];

/** Ids of activities that overlap the following one in time on the same day. */
export function overlappingIds(items: Activity[]) {
  const overlapping = new Set<string>();
  [...items].filter((item) => isValidTime(item.time)).sort((a, b) => minutes(a.time) - minutes(b.time)).forEach((item, index, sorted) => {
    const next = sorted[index + 1];
    if (next && minutes(item.time) + item.duration > minutes(next.time)) {
      overlapping.add(item.id);
      overlapping.add(next.id);
    }
  });
  return overlapping;
}

/**
 * True when going from `before` to `after` would add, remove, edit or reorder
 * anything on one of the locked days. Every write path checks this.
 */
export function touchesLockedDay(before: Activity[], after: Activity[], lockedDays: Set<string>) {
  if (!lockedDays.size) return false;
  for (const dayId of lockedDays) {
    const a = before.filter((activity) => activity.dayId === dayId);
    const b = after.filter((activity) => activity.dayId === dayId);
    if (a.length !== b.length) return true;
    for (let index = 0; index < a.length; index += 1) {
      if (JSON.stringify(a[index]) !== JSON.stringify(b[index])) return true;
    }
  }
  return false;
}

let idCounter = 0;
/** Stable, unique id created once per new activity (never at render time). */
export function newActivityId(prefix = "act") {
  idCounter += 1;
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${random}`;
}
