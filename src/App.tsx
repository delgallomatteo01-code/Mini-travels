import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AlertTriangle, ArrowLeft, CalendarCheck2, CalendarDays, ChevronRight, Edit3, Eye, Home as HomeIcon, Lock, Plus, Route, Settings, Smartphone, Sparkles, Undo2, Unlock, WalletCards, X } from "lucide-react";
import { DEFAULT_SITE_SETTINGS, type SiteAssetKind, type SiteSettings } from "../shared/site-settings";
import { ActivityEditor } from "./components/ActivityEditor";
import { TripsArchiveHome } from "./components/Archive";
import { DayPickerDialog, DeleteTripDialog, InstallationDialog, LoginScreen, SettingsDialog, TripEditorDialog } from "./components/Dialogs";
import { ActivityCard, CANCEL_PLANNING_DROP_ID, DayColumn, DragPreviewCard, PlanningCancelDropZone, TodayActivityCard } from "./components/Itinerary";
import { PlanningView } from "./components/Planning";
import { TripSummary } from "./components/Summary";
import { CoupleAvatars, BrandLogo, CoverImage, NavButton, Stat, SyncBadge, Toast, type ToastMessage } from "./components/ui";
import {
  CONFIRMED_STATUSES,
  daysUntil,
  formatTripDate,
  formatTripRange,
  generateTripDays,
  isOrphan,
  localDateKey,
  minutes,
  newActivityId,
  sanitizeImportedActivities,
  scheduledActivities,
  touchesLockedDay,
  tripDayCount,
  tripTiming,
  unscheduledActivities,
} from "./lib/activities";
import { api, ApiError, UNAUTHORIZED_EVENT } from "./lib/api";
import { INITIAL_ACTIVITIES, PARIS_TRIP, makeActivity } from "./lib/data";
import { PLANNING_DAY_ID, type Activity, type Day, type InstallPromptEvent, type Trip, type TripInput, type View } from "./lib/types";
import { useItinerarySync } from "./lib/useItinerarySync";

type Draft = { activity: Activity; isNew: boolean; readOnly: boolean; reason?: string };
type Session = { checked: boolean; authenticated: boolean; configured: boolean; authDisabled: boolean };

const lockKey = (tripId: string) => `${tripId}-locked-days-v1`;

function readHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const view = params.get("view") as View | null;
  return {
    tripId: params.get("trip"),
    view: view && ["home", "itinerary", "planning", "trip"].includes(view) ? view : null,
  };
}

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function App() {
  const [session, setSession] = useState<Session>({ checked: false, authenticated: false, configured: true, authDisabled: false });

  const checkSession = useCallback(async () => {
    try {
      const { data } = await api<Omit<Session, "checked">>("/api/session");
      setSession({ checked: true, ...data });
    } catch {
      // Server unreachable: let the app try with the cached data.
      setSession((current) => ({ ...current, checked: true, authenticated: true }));
    }
  }, []);

  useEffect(() => {
    void checkSession();
    const onUnauthorized = () => setSession((current) => ({ ...current, authenticated: false }));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [checkSession]);

  if (!session.checked) return <main className="login-shell"><p className="loading-note">Caricamento…</p></main>;
  if (!session.authenticated) return <LoginScreen appName={DEFAULT_SITE_SETTINGS.appName} configured={session.configured} onLoggedIn={() => void checkSession()} />;
  return <TravelApp canLogout={!session.authDisabled} onLoggedOut={() => void checkSession()} />;
}

function TravelApp({ canLogout, onLoggedOut }: { canLogout: boolean; onLoggedOut: () => void }) {
  const initialHash = useRef(readHash());
  const [view, setView] = useState<View>(initialHash.current.tripId ? initialHash.current.view ?? "home" : "trips");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [tripsError, setTripsError] = useState("");
  const [activeTripId, setActiveTripId] = useState<string | null>(initialHash.current.tripId);
  const [tripEditor, setTripEditor] = useState<Trip | "new" | null>(null);
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [history, setHistory] = useState<Activity[][]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editMode, setEditMode] = useState(true);
  const [lockedDays, setLockedDays] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Tutte");
  const [planningDrawer, setPlanningDrawer] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<Activity | null>(null);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const dayTabsRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((text: string, tone: ToastMessage["tone"] = "info", undo = false) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, tone, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), tone === "error" ? 5_000 : undo ? 4_000 : 2_600);
  }, []);

  const activeTrip = trips.find((trip) => trip.id === activeTripId) ?? null;
  const sync = useItinerarySync(activeTrip?.id ?? null, (message) => showToast(message));
  const { activities, hydrated, syncState } = sync;
  const activitiesRef = useRef(activities);
  activitiesRef.current = activities;
  const days = useMemo<Day[]>(() => activeTrip ? generateTripDays(activeTrip) : [], [activeTrip]);

  // Undo history is per trip and per session; it never survives a remote update.
  useEffect(() => { setHistory([]); }, [sync.remoteRevision]);

  useEffect(() => {
    if (!activeTrip) return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(lockKey(activeTrip.id)) ?? "[]") as unknown;
      const validIds = new Set(days.map((day) => day.id));
      setLockedDays(new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string" && validIds.has(id)) : []));
    } catch {
      setLockedDays(new Set());
    }
  }, [activeTrip, days]);

  useEffect(() => {
    if (days.length && !days.some((day) => day.id === selectedDay)) setSelectedDay(days[0].id);
  }, [days, selectedDay]);

  // Keep the open trip and view in the URL so a shared or reloaded link opens it.
  useEffect(() => {
    const hash = view === "trips" || !activeTripId ? "" : `#trip=${encodeURIComponent(activeTripId)}&view=${view}`;
    if (window.location.hash !== hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  }, [view, activeTripId]);

  useEffect(() => {
    if (!tripsLoading && activeTripId && !trips.some((trip) => trip.id === activeTripId) && !tripsError) {
      setActiveTripId(null);
      setView("trips");
    }
  }, [tripsLoading, trips, activeTripId, tripsError]);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const { data } = await api<{ settings?: SiteSettings }>("/api/site-settings");
        if (!cancelled && data.settings) setSettings((current) => JSON.stringify(current) === JSON.stringify(data.settings) ? current : data.settings!);
      } catch { /* keep the last settings */ }
    }
    void loadSettings();
    const interval = window.setInterval(() => void loadSettings(), 10_000);
    window.addEventListener("focus", loadSettings);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener("focus", loadSettings); };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--paper", settings.backgroundColor);
    root.style.setProperty("--card", settings.cardColor);
    root.style.setProperty("--ink", settings.textColor);
    root.style.setProperty("--muted", settings.mutedColor);
    root.style.setProperty("--terra", settings.accentColor);
    root.style.setProperty("--sage", settings.secondaryAccentColor);
    document.title = `${settings.appName} — ${settings.appSubtitle}`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", settings.backgroundColor);
  }, [settings]);

  const loadTrips = useCallback(async () => {
    try {
      const { data } = await api<{ trips?: Trip[] }>("/api/trips");
      if (Array.isArray(data.trips)) setTrips((current) => JSON.stringify(current) === JSON.stringify(data.trips) ? current : data.trips!);
      setTripsError("");
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) setTripsError("Archivio non raggiungibile: verranno mostrati i dati appena la connessione torna.");
    } finally {
      setTripsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrips();
    const interval = window.setInterval(() => void loadTrips(), 8_000);
    const refresh = () => { if (document.visibilityState === "visible") void loadTrips(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadTrips]);

  useEffect(() => {
    if (!isMobile || !activeId) return;
    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [activeId, isMobile]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 840px)");
    const updateViewport = () => setIsMobile(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    const container = dayTabsRef.current;
    const activeTab = container?.querySelector<HTMLElement>(`[data-day-id="${selectedDay}"]`);
    if (!container || !activeTab) return;
    container.scrollTo({ left: activeTab.offsetLeft - (container.clientWidth - activeTab.clientWidth) / 2, behavior: "smooth" });
  }, [isMobile, selectedDay, view]);

  useEffect(() => {
    const updateNow = () => setNow(new Date());
    updateNow();
    const interval = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    setIsStandalone(standalone);
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setIsStandalone(true);
      setInstallPrompt(null);
      setInstallDialogOpen(false);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 12 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeActivity = activities.find((activity) => activity.id === activeId);
  const selected = days.find((day) => day.id === selectedDay) ?? days[0];
  const planned = scheduledActivities(activities, days);
  const confirmed = planned.filter((activity) => CONFIRMED_STATUSES.includes(activity.status)).length;
  const toBook = planned.filter((activity) => activity.status === "Da prenotare").length;
  const unscheduled = unscheduledActivities(activities, days);
  const groups = useMemo(() => Object.fromEntries(days.map((day) => [day.id, activities.filter((activity) => activity.dayId === day.id)])) as Record<string, Activity[]>, [activities, days]);
  const canEdit = editMode && hydrated;

  const todayDateKey = now ? localDateKey(now) : "";
  const timing = activeTrip && todayDateKey ? tripTiming(activeTrip, todayDateKey) : "upcoming";
  const countdown = activeTrip && todayDateKey ? daysUntil(activeTrip.startDate, todayDateKey) : 0;
  const todayDay = days.find((day) => day.date === todayDateKey);
  const todayActivities = todayDay ? activities.filter((activity) => activity.dayId === todayDay.id).sort((a, b) => minutes(a.time) - minutes(b.time)) : [];

  /**
   * The single write path for activities. It refuses changes in view-only
   * mode, before the itinerary is loaded and on locked days, so every control
   * (drag, quick actions, editor, import, undo, reset, tickets) is covered.
   */
  function commit(update: Activity[] | ((current: Activity[]) => Activity[]), message: string, options: { trackHistory?: boolean } = {}) {
    if (!editMode) { showToast("Attiva “Modifica” per cambiare l’itinerario", "error"); return false; }
    if (!hydrated) { showToast("Attendi il caricamento dell’itinerario", "error"); return false; }
    const current = activitiesRef.current;
    const next = typeof update === "function" ? update(current) : update;
    if (next === current) return false;
    if (touchesLockedDay(current, next, lockedDays)) { showToast("Questa modifica tocca una giornata bloccata", "error"); return false; }
    if (options.trackHistory !== false) setHistory((list) => [...list.slice(-9), current]);
    activitiesRef.current = next;
    sync.save(next);
    showToast(message, "info", options.trackHistory !== false);
    return true;
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    if (commit(previous, "Ultima modifica annullata", { trackHistory: false })) setHistory((list) => list.slice(0, -1));
  }

  function isLocked(dayId: string) {
    return dayId !== PLANNING_DAY_ID && lockedDays.has(dayId);
  }

  function openActivity(activity: Activity) {
    if (!editMode) { setDraft({ activity, isNew: false, readOnly: true, reason: "Modalità visualizzazione: attiva “Modifica” per cambiare l’attività." }); return; }
    if (isLocked(activity.dayId)) { setDraft({ activity, isNew: false, readOnly: true, reason: "Questa giornata è bloccata: sbloccala per modificare." }); return; }
    setDraft({ activity, isNew: false, readOnly: false });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!editMode) return;
    if (over?.id === CANCEL_PLANNING_DROP_ID) { showToast("Spostamento annullato"); return; }
    if (!over || active.id === over.id) return;
    const current = activitiesRef.current;
    const activeItem = current.find((item) => item.id === active.id);
    const overItem = current.find((item) => item.id === over.id);
    if (!activeItem) return;
    const targetDay = overItem?.dayId ?? String(over.id);
    if (targetDay !== PLANNING_DAY_ID && !days.some((day) => day.id === targetDay) && !overItem) return;
    if (isLocked(activeItem.dayId) || isLocked(targetDay)) { showToast("Questa giornata è bloccata", "error"); return; }

    let next = current;
    if (activeItem.dayId === targetDay) {
      const dayItems = current.filter((item) => item.dayId === targetDay);
      const oldDayIndex = dayItems.findIndex((item) => item.id === active.id);
      const newDayIndex = overItem ? dayItems.findIndex((item) => item.id === overItem.id) : dayItems.length - 1;
      if (oldDayIndex < 0 || newDayIndex < 0 || oldDayIndex === newDayIndex) return;
      const reorderedDay = arrayMove(dayItems, oldDayIndex, newDayIndex);
      let replacementIndex = 0;
      next = current.map((item) => item.dayId === targetDay ? reorderedDay[replacementIndex++] : item);
    } else {
      const moved = { ...activeItem, dayId: targetDay };
      const withoutActive = current.filter((item) => item.id !== active.id);
      if (!overItem) next = [...withoutActive, moved];
      else {
        const targetIndex = withoutActive.findIndex((item) => item.id === overItem.id);
        next = [...withoutActive.slice(0, targetIndex), moved, ...withoutActive.slice(targetIndex)];
      }
    }
    const dayName = targetDay === PLANNING_DAY_ID ? "Da pianificare" : days.find((day) => day.id === targetDay)?.tab;
    commit(next, activeItem.dayId === targetDay ? "Ordine aggiornato" : `Attività spostata in ${dayName}`);
  }

  function handleDragStart(id: string) {
    if (!editMode) return;
    setActiveId(id);
    const activity = activitiesRef.current.find((item) => item.id === id);
    if (isMobile && activity && unscheduled.some((item) => item.id === activity.id)) {
      window.requestAnimationFrame(() => setPlanningDrawer(false));
    }
  }

  function openNew(dayId = selectedDay || PLANNING_DAY_ID) {
    if (!canEdit) { showToast("Attiva “Modifica” per aggiungere attività", "error"); return; }
    const target = isLocked(dayId) ? PLANNING_DAY_ID : dayId;
    if (target !== dayId) showToast("Giornata bloccata: la nuova attività andrà in “Da pianificare”");
    setDraft({ activity: makeActivity(newActivityId(), target, "10:00", "", "Attrazione", 60, activeTrip?.destination ?? "", "Da prenotare"), isNew: true, readOnly: false });
  }

  function saveDraft(activity: Activity) {
    const exists = activitiesRef.current.some((item) => item.id === activity.id);
    const ok = commit((current) => exists ? current.map((item) => item.id === activity.id ? activity : item) : [...current, activity], exists ? "Attività aggiornata" : "Attività creata");
    if (ok) setDraft(null);
  }

  function duplicate(activity: Activity) {
    const copy = { ...activity, id: newActivityId("copy"), title: `${activity.title} — copia` };
    delete copy.ticket;
    if (commit((current) => {
      const index = current.findIndex((item) => item.id === activity.id);
      return index < 0 ? [...current, copy] : [...current.slice(0, index + 1), copy, ...current.slice(index + 1)];
    }, "Attività duplicata")) setDraft({ activity: copy, isNew: false, readOnly: false });
  }

  function remove(activity: Activity) {
    if (commit((current) => current.filter((item) => item.id !== activity.id), "Attività eliminata")) setDraft(null);
  }

  function moveRelative(activity: Activity, direction: -1 | 1) {
    commit((current) => {
      const indexes = current.map((item, index) => item.dayId === activity.dayId ? index : -1).filter((index) => index >= 0);
      const position = indexes.indexOf(current.findIndex((item) => item.id === activity.id));
      const target = indexes[position + direction];
      return target === undefined || position < 0 ? current : arrayMove(current, indexes[position], target);
    }, direction < 0 ? "Attività spostata su" : "Attività spostata giù");
  }

  function toggleDayLock(day: Day) {
    if (!activeTrip) return;
    const willLock = !lockedDays.has(day.id);
    const next = new Set(lockedDays);
    if (willLock) next.add(day.id);
    else next.delete(day.id);
    setLockedDays(next);
    try { window.localStorage.setItem(lockKey(activeTrip.id), JSON.stringify([...next])); } catch { /* preference only */ }
    if (willLock) setDraft((current) => current?.activity.dayId === day.id && !current.readOnly ? null : current);
    showToast(willLock ? `${day.tab} bloccato su questo dispositivo` : `${day.tab} sbloccato`);
  }

  function scheduleActivity(activity: Activity, dayId: string) {
    const day = days.find((item) => item.id === dayId);
    if (commit((current) => {
      // Scheduled from the list: append at the end of the chosen day.
      const moved = { ...activity, ...current.find((item) => item.id === activity.id), dayId };
      return [...current.filter((item) => item.id !== activity.id), moved];
    }, `Attività aggiunta a ${day?.tab ?? "itinerario"}`)) {
      setSelectedDay(dayId);
      setScheduleTarget(null);
    }
  }

  async function uploadTicket(activityId: string, file: File) {
    if (!activeTrip) return;
    const target = activitiesRef.current.find((item) => item.id === activityId);
    if (!target) throw new Error("Salva l’attività prima di caricare il biglietto");
    if (!editMode || isLocked(target.dayId)) {
      const message = !editMode ? "Attiva “Modifica” per caricare documenti" : "Giornata bloccata: sbloccala per caricare documenti";
      showToast(message, "error");
      throw new Error(message);
    }
    const form = new FormData();
    form.append("file", file);
    form.append("tripId", activeTrip.id);
    form.append("activityId", activityId);
    try {
      const { data } = await api<{ ticket?: Activity["ticket"] }>("/api/tickets", { method: "POST", body: form });
      if (!data.ticket) throw new Error("Caricamento non riuscito");
      const ticket = data.ticket;
      commit((current) => current.map((item) => item.id === activityId ? { ...item, ticket } : item), "Biglietto caricato");
      setDraft((current) => current?.activity.id === activityId ? { ...current, activity: { ...current.activity, ticket } } : current);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Caricamento non riuscito", "error");
      throw error;
    }
  }

  function resetItinerary() {
    if (!activeTrip) return;
    const isExample = activeTrip.id === PARIS_TRIP.id;
    const message = isExample
      ? "Ripristinare l’itinerario di esempio iniziale? Le attività attuali di questo viaggio verranno sostituite per entrambi (puoi annullare subito dopo)."
      : "Svuotare l’itinerario di questo viaggio? Tutte le attività verranno rimosse per entrambi (puoi annullare subito dopo).";
    if (!window.confirm(message)) return;
    commit(isExample ? INITIAL_ACTIVITIES : [], isExample ? "Itinerario di esempio ripristinato" : "Itinerario svuotato");
  }

  function exportJson() {
    if (!activeTrip) return;
    downloadJson({ trip: activeTrip, activities }, `${activeTrip.id}-itinerario.json`);
  }

  function importJson(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = sanitizeImportedActivities(JSON.parse(String(reader.result)));
        const tickets = next.filter((item) => item.ticket).length;
        if (!window.confirm(`Sostituire le ${activitiesRef.current.length} attività di “${activeTrip?.title}” con le ${next.length} del file?${tickets ? `\n\n${tickets} attività fanno riferimento a biglietti: i file non sono nel JSON e, se provengono da un’altra installazione, andranno ricaricati.` : ""}`)) return;
        commit(next, "Itinerario importato");
      } catch (error) {
        showToast(error instanceof Error ? `File JSON non valido: ${error.message}` : "File JSON non valido", "error");
      }
    };
    reader.onerror = () => showToast("Impossibile leggere il file", "error");
    reader.readAsText(file);
  }

  async function shareTrip() {
    if (!activeTrip) return;
    const url = `${window.location.origin}${window.location.pathname}#trip=${encodeURIComponent(activeTrip.id)}&view=home`;
    const data = { title: activeTrip.title, text: `Il viaggio di ${settings.appSubtitle} a ${activeTrip.destination}`, url };
    if (navigator.share) {
      await navigator.share(data).catch(() => undefined);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copiato: chi lo apre dovrà comunque inserire la password");
    } catch {
      window.prompt("Copia il link del viaggio:", url);
    }
  }

  function openTrip(trip: Trip) {
    setActiveTripId(trip.id);
    setSelectedDay(generateTripDays(trip)[0]?.id ?? "");
    setPlanningDrawer(false);
    setDraft(null);
    setHistory([]);
    setView("home");
  }

  async function saveTrip(input: TripInput) {
    const editing = tripEditor !== "new" && tripEditor !== null ? tripEditor : null;
    const { data } = await api<{ trip?: Trip }>("/api/trips", {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(editing ? { ...input, id: editing.id } : input),
    });
    if (!data.trip) throw new Error("Impossibile salvare il viaggio");
    const saved = data.trip;
    setTrips((current) => editing
      ? current.map((trip) => trip.id === saved.id ? saved : trip)
      : [...current, saved].sort((a, b) => a.startDate.localeCompare(b.startDate)));
    setTripEditor(null);
    showToast(editing ? "Viaggio aggiornato" : "Nuovo viaggio creato");
  }

  async function deleteTrip(trip: Trip) {
    const { data } = await api<{ deleted?: boolean; filesCleaned?: boolean }>(`/api/trips?id=${encodeURIComponent(trip.id)}`, { method: "DELETE" });
    if (!data.deleted) throw new Error("Impossibile eliminare il viaggio");
    setTrips((current) => current.filter((item) => item.id !== trip.id));
    for (const key of [`${trip.id}-itinerary-v2`, `${trip.id}-conflict-v1`, lockKey(trip.id)]) {
      try { window.localStorage.removeItem(key); } catch { /* ignore */ }
    }
    if (activeTripId === trip.id) {
      setActiveTripId(null);
      setView("trips");
    }
    setTripToDelete(null);
    showToast(data.filesCleaned === false ? "Viaggio eliminato (alcuni file non sono stati rimossi)" : "Viaggio eliminato definitivamente");
  }

  async function importTripPayload(payload: { trip: unknown; activities: unknown }, keepId = true): Promise<string> {
    const activitiesList = sanitizeImportedActivities(payload.activities ?? []);
    try {
      const { status, data } = await api<{ trip?: Trip; activities?: number; ticketReferences?: number; error?: string }>("/api/trips/import", {
        method: "POST",
        body: JSON.stringify({ trip: payload.trip, activities: activitiesList, keepId }),
      });
      if (status === 409) {
        const title = (payload.trip as { title?: string })?.title ?? "viaggio";
        if (!window.confirm(`${data.error ?? "Viaggio già presente."}\n\nVuoi importare “${title}” come copia con un nuovo ID?`)) return `“${title}” non importato: esiste già.`;
        return importTripPayload(payload, false);
      }
      if (!data.trip) throw new Error("Importazione non riuscita");
      return `“${data.trip.title}” importato con ${data.activities ?? 0} attività${data.ticketReferences ? `; ${data.ticketReferences} biglietti da ricaricare` : ""}.`;
    } catch (error) {
      throw error instanceof Error ? error : new Error("Importazione non riuscita");
    }
  }

  async function importTripFile(file: File) {
    const parsed = JSON.parse(await file.text()) as unknown;
    let messages: string[];
    if (parsed && typeof parsed === "object" && (parsed as { format?: string }).format === "me-viaggi-backup") {
      const entries = (parsed as { trips?: Array<{ trip: unknown; activities: unknown }> }).trips ?? [];
      messages = [];
      for (const entry of entries) {
        try { messages.push(await importTripPayload(entry)); }
        catch (error) { messages.push(error instanceof Error ? error.message : "Viaggio non importato"); }
      }
    } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "trip" in parsed) {
      messages = [await importTripPayload(parsed as { trip: unknown; activities: unknown })];
    } else {
      throw new Error("Serve un file { trip, activities } (Esporta JSON) o un backup completo. Un elenco di sole attività va importato dal riepilogo di un viaggio esistente.");
    }
    await loadTrips();
    return messages.join(" ");
  }

  async function downloadBackup() {
    const { data } = await api<{ trips?: Trip[] }>("/api/trips");
    const entries = [];
    for (const trip of data.trips ?? []) {
      const itinerary = await api<{ activities: unknown; version: number }>(`/api/itinerary?tripId=${encodeURIComponent(trip.id)}`);
      entries.push({ trip, activities: itinerary.data.activities ?? [], version: itinerary.data.version });
    }
    downloadJson({ format: "me-viaggi-backup", exportedAt: new Date().toISOString(), settings, trips: entries }, `me-viaggi-backup-${localDateKey()}.json`);
  }

  async function createExampleTrip() {
    try {
      const message = await importTripPayload({ trip: PARIS_TRIP, activities: INITIAL_ACTIVITIES });
      await loadTrips();
      showToast(message);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Impossibile creare l’esempio", "error");
    }
  }

  async function saveSettings(next: SiteSettings) {
    const { data } = await api<{ settings?: SiteSettings }>("/api/site-settings", { method: "PUT", body: JSON.stringify(next) });
    if (!data.settings) throw new Error("Impossibile salvare le impostazioni");
    setSettings(data.settings);
    showToast("Impostazioni aggiornate");
  }

  async function uploadSiteAsset(kind: SiteAssetKind, file: File, extra: File[] = []) {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    if (kind === "logo") {
      if (!extra[0] || !extra[1]) throw new Error("Impossibile generare le icone app");
      form.append("icon192", extra[0]);
      form.append("icon512", extra[1]);
    }
    const { data } = await api<{ settings?: SiteSettings }>("/api/site-settings", { method: "POST", body: form });
    if (!data.settings) throw new Error("Caricamento non riuscito");
    const saved = data.settings;
    // Only the new asset versions are applied; unsaved text edits stay in the dialog.
    setSettings((current) => ({ ...current, logoVersion: saved.logoVersion, travellerOnePhotoVersion: saved.travellerOnePhotoVersion, travellerTwoPhotoVersion: saved.travellerTwoPhotoVersion, memoryOneVersion: saved.memoryOneVersion, memoryTwoVersion: saved.memoryTwoVersion, memoryThreeVersion: saved.memoryThreeVersion }));
    return saved;
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setIsStandalone(true);
      setInstallPrompt(null);
      return;
    }
    setInstallDialogOpen(true);
  }

  async function logout() {
    await api("/api/logout", { method: "POST" }).catch(() => undefined);
    onLoggedOut();
  }

  function swipeDay(endX: number, endY: number) {
    if (activeId || !touchStart) return;
    const deltaX = endX - touchStart.x;
    const deltaY = endY - touchStart.y;
    setTouchStart(null);
    if (Math.abs(deltaX) < 80 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
    const index = days.findIndex((day) => day.id === selectedDay);
    const next = Math.min(days.length - 1, Math.max(0, index + (deltaX < 0 ? 1 : -1)));
    setSelectedDay(days[next].id);
  }

  const settingsDialog = settingsOpen && <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} onUpload={uploadSiteAsset} onImportFile={importTripFile} onDownloadBackup={downloadBackup} />;
  const toastNode = toast && <Toast toast={{ ...toast, undo: toast.undo && history.length > 0 && editMode }} onUndo={undo} />;

  if (view === "trips" || !activeTrip) {
    return (
      <main className="trips-shell">
        <TripsArchiveHome
          trips={trips}
          loading={tripsLoading}
          loadError={tripsError}
          now={now}
          settings={settings}
          onOpen={openTrip}
          onNew={() => setTripEditor("new")}
          onEdit={setTripEditor}
          onDelete={setTripToDelete}
          onInstall={() => void installApp()}
          onSettings={() => setSettingsOpen(true)}
          onCreateExample={() => void createExampleTrip()}
          onLogout={() => void logout()}
          isStandalone={isStandalone}
          showLogout={canLogout}
        />
        {tripEditor && <TripEditorDialog trip={tripEditor === "new" ? undefined : tripEditor} onClose={() => setTripEditor(null)} onSave={saveTrip} />}
        {tripToDelete && <DeleteTripDialog trip={tripToDelete} onClose={() => setTripToDelete(null)} onConfirm={deleteTrip} />}
        {settingsDialog}
        {installDialogOpen && <InstallationDialog settings={settings} isIOS={isIOS} onClose={() => setInstallDialogOpen(false)} />}
        {toastNode}
      </main>
    );
  }

  const conflictBanner = sync.conflict && <div className="conflict-banner" role="alert">
    <AlertTriangle />
    <div><strong>Modifica contemporanea</strong><span>Sull’altro dispositivo l’itinerario è cambiato mentre lo modificavi. Ora vedi la versione più recente; la tua ({sync.conflict.activities.length} attività) è conservata.</span></div>
    <div className="conflict-actions">
      <button type="button" className="secondary-button" onClick={() => { if (window.confirm("Sostituire la versione attuale con la tua? Le modifiche fatte dall’altro dispositivo andranno perse.")) sync.resolveConflict("mine"); }}><Undo2 size={15} /> Ripristina la mia</button>
      <button type="button" className="secondary-button" onClick={() => sync.resolveConflict("theirs")}><X size={15} /> Tieni la più recente</button>
    </div>
  </div>;

  return (
    <main className="app-shell">
      <aside className="desktop-nav">
        <button type="button" className="brand-mark" onClick={() => setView("trips")} aria-label={`Torna all’archivio di ${settings.appName}`}><BrandLogo settings={settings} /></button>
        <nav aria-label="Navigazione principale">
          <NavButton icon={<HomeIcon />} label="Home" active={view === "home"} onClick={() => setView("home")} />
          <NavButton icon={<CalendarDays />} label="Itinerario" active={view === "itinerary"} onClick={() => setView("itinerary")} />
          <NavButton icon={<Sparkles />} label="Da pianificare" active={view === "planning"} onClick={() => setView("planning")} />
          <NavButton icon={<WalletCards />} label="Riepilogo" active={view === "trip"} onClick={() => setView("trip")} />
          <NavButton icon={<Settings />} label="Impostazioni" active={settingsOpen} onClick={() => setSettingsOpen(true)} />
        </nav>
        <CoupleAvatars settings={settings} />
      </aside>

      {view === "home" && (
        <section className="home-view">
          <div className="home-hero">
            <CoverImage src={activeTrip.image} alt={`Copertina ${activeTrip.title}`} positionY={activeTrip.imagePositionY} scale={activeTrip.imageScale} />
            <div className="hero-wash" />
            <div className="hero-copy">
              <p className="eyebrow">Il nostro viaggio • {activeTrip.destination}</p>
              <h1 className="dynamic-trip-title">{activeTrip.title}</h1>
              <div className="travellers"><CoupleAvatars settings={settings} /><p>{settings.appSubtitle}<br /><small>{formatTripRange(activeTrip)}</small></p></div>
              <div className="hero-actions">
                <button type="button" className="primary-button" onClick={() => setView("itinerary")}>Apri itinerario <ChevronRight size={18} /></button>
                <button type="button" className="install-button" onClick={() => setTripEditor(activeTrip)}><Edit3 size={17} /> Modifica viaggio</button>
                {!isStandalone && <button type="button" className="install-button" onClick={() => void installApp()}><Smartphone size={17} /> Installa app</button>}
              </div>
            </div>
            <div className="countdown" aria-live="polite">
              <div className="countdown-number"><strong>{timing === "current" ? (todayDay ? days.indexOf(todayDay) + 1 : "•") : timing === "past" ? "✓" : countdown}</strong></div>
              <span>{timing === "current" ? <>giorno<br />del viaggio</> : timing === "past" ? <>viaggio<br />concluso</> : countdown === 1 ? <>giorno<br />alla partenza</> : <>giorni<br />alla partenza</>}</span>
            </div>
          </div>

          <div className="home-content">
            <div>
              <p className="section-kicker">Il nostro viaggio</p>
              <h2>{tripDayCount(activeTrip)} giorni da vivere,<br />un ricordo da costruire.</h2>
              <p className="intro">Un’agenda condivisa per tenere insieme trasporti, tappe, prenotazioni e tutte le deviazioni belle che {activeTrip.destination} ci regalerà.</p>
            </div>
            <div className="stat-grid">
              <Stat value={String(tripDayCount(activeTrip))} label="giorni" />
              <Stat value={String(planned.length)} label="tappe in programma" />
              <Stat value={String(confirmed)} label="confermate" />
              <Stat value={String(toBook)} label="da prenotare" accent />
            </div>
          </div>

          <section className="home-today" aria-labelledby="today-itinerary-title">
            <header>
              <div>
                <p className="section-kicker">Agenda automatica</p>
                <h2 id="today-itinerary-title">{todayDay ? todayDay.full : "Itinerario di oggi"}</h2>
              </div>
              <span className="read-only-badge"><Eye size={14} /> Solo visualizzazione</span>
            </header>
            {todayDay ? (
              <>
                <p className="today-theme">{todayDay.theme}</p>
                {todayActivities.length ? (
                  <div className="today-grid">{todayActivities.map((activity) => <TodayActivityCard key={activity.id} activity={activity} />)}</div>
                ) : (
                  <div className="today-empty"><CalendarCheck2 /><div><h3>Nessuna attività per oggi</h3><p>La giornata è ancora libera.</p></div></div>
                )}
              </>
            ) : (
              <div className="today-empty">
                <CalendarDays />
                <div>
                  <h3>{timing === "past" ? "Il viaggio si è concluso" : "Qui comparirà la giornata di oggi"}</h3>
                  <p>{timing === "past" ? "L’itinerario resta disponibile nella sezione dedicata." : `Dal ${formatTripDate(activeTrip.startDate, { day: "numeric", month: "long" })} vedrete automaticamente le tappe previste per la giornata.`}</p>
                </div>
              </div>
            )}
          </section>
        </section>
      )}

      {view === "itinerary" && selected && (
        <section className="workspace-view">
          <div className="itinerary-sticky-header"><header className="workspace-header">
            <div><p className="section-kicker">{activeTrip.destination} • {formatTripRange(activeTrip)}</p><h1>Il nostro itinerario</h1></div>
            <div className="header-actions">
              <SyncBadge state={syncState} detail={sync.lastError} />
              <button type="button" className={`mode-button ${editMode ? "active" : "view-only"}`} aria-pressed={editMode} onClick={() => setEditMode((value) => !value)}>
                {editMode ? <Edit3 size={16} /> : <Eye size={16} />}
                <span>{editMode ? "Modifica attiva" : "Solo visualizzazione"}</span>
              </button>
              <button type="button" className="new-button" disabled={!canEdit} onClick={() => openNew()}><Plus size={17} /> <span>Nuova attività</span></button>
            </div>
          </header>
          {conflictBanner}
          <div className={`edit-mode-banner ${editMode ? "active" : "view-only"}`} role="status">
            {editMode ? <Edit3 /> : <Eye />}
            <div>
              <strong>{editMode ? "Modalità modifica attiva" : "Modalità visualizzazione"}</strong>
              <span>{editMode ? (isMobile ? "Tieni premuta la maniglia per trascinare, oppure usa “Sposta su/giù”. Tocca una card per modificarla." : "Trascina le card tra i giorni o tocca una card per modificarla. I lucchetti bloccano singole giornate su questo dispositivo.") : "Le attività sono bloccate: tocca una card per vederne i dettagli."}</span>
            </div>
            {!isMobile && <button type="button" className={`drawer-toggle ${planningDrawer ? "active" : ""}`} onClick={() => setPlanningDrawer((value) => !value)} aria-expanded={planningDrawer}><Sparkles size={15} /> Da pianificare <b>{unscheduled.length}</b></button>}
          </div>
          <div className="day-tabs" role="tablist" aria-label="Giorni del viaggio" ref={dayTabsRef}>
            {days.map((day) => <button type="button" role="tab" aria-selected={selected.id === day.id} key={day.id} data-day-id={day.id} className={selected.id === day.id ? "active" : ""} onClick={() => setSelectedDay(day.id)}>{lockedDays.has(day.id) && <Lock size={12} />} {day.tab}</button>)}
          </div></div>
          <div className={`mobile-day-heading ${lockedDays.has(selected.id) ? "locked" : ""}`}>
            <div>
              <p>{selected.full}</p>
              <span>{lockedDays.has(selected.id) ? "Le attività di questo giorno non possono essere modificate" : selected.theme}</span>
            </div>
            <button type="button" className={`mobile-day-lock ${lockedDays.has(selected.id) ? "locked" : ""}`} onClick={() => toggleDayLock(selected)} aria-pressed={lockedDays.has(selected.id)} aria-label={lockedDays.has(selected.id) ? `Sblocca ${selected.full}` : `Blocca ${selected.full}`}>
              {lockedDays.has(selected.id) ? <Lock /> : <Unlock />}
              <span>{lockedDays.has(selected.id) ? "Sblocca giorno" : "Blocca giorno"}</span>
            </button>
          </div>
          {!hydrated && <p className="loading-note">{syncState === "offline" ? "Itinerario non raggiungibile: riprovo automaticamente…" : "Caricamento dell’itinerario…"}</p>}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            autoScroll={!isMobile}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={(event) => handleDragStart(String(event.active.id))}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            {!isMobile ? (
              <div className={`board desktop-board ${planningDrawer ? "with-drawer" : ""}`} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(${days.length > 8 ? "180px" : "0"}, 1fr))` }}>
                {days.map((day) => <DayColumn key={day.id} day={day} items={groups[day.id] ?? []} onOpen={openActivity} canDrag={canEdit && !lockedDays.has(day.id)} locked={lockedDays.has(day.id)} onToggleLock={() => toggleDayLock(day)} />)}
              </div>
            ) : (
              <div
                className={`mobile-board ${activeId ? "dragging-active" : ""}`}
                onTouchStart={(event) => setTouchStart({ x: event.touches[0].clientX, y: event.touches[0].clientY })}
                onTouchEnd={(event) => swipeDay(event.changedTouches[0].clientX, event.changedTouches[0].clientY)}
              >
                <DayColumn
                  day={selected}
                  items={groups[selected.id] ?? []}
                  onOpen={openActivity}
                  canDrag={canEdit && !lockedDays.has(selected.id)}
                  locked={lockedDays.has(selected.id)}
                  quickActions={canEdit && !lockedDays.has(selected.id)}
                  onMoveRelative={moveRelative}
                  onDelete={remove}
                />
              </div>
            )}
            {isMobile && activeActivity && unscheduled.some((item) => item.id === activeActivity.id) && <PlanningCancelDropZone />}
            <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>{activeActivity ? <div className="drag-preview"><DragPreviewCard activity={activeActivity} /></div> : null}</DragOverlay>
            {planningDrawer && <aside className="planning-drawer" aria-label="Attività da pianificare">
              <header><div><p className="section-kicker">Idee salvate</p><h2>Da pianificare</h2></div><button type="button" className="icon-button" onClick={() => setPlanningDrawer(false)} aria-label="Chiudi pannello"><X /></button></header>
              <p className="drawer-help">{canEdit ? "Trascina una card nel giorno desiderato, oppure usa “Scegli il giorno”." : "Attiva “Modifica” per inserire queste idee nell’itinerario."}</p>
              <SortableContext items={unscheduled.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                <div className="drawer-list">{unscheduled.map((activity) => <ActivityCard key={activity.id} activity={activity} onOpen={openActivity} canDrag={canEdit} orphan={isOrphan(activity, days)} onSchedule={canEdit ? setScheduleTarget : undefined} />)}</div>
              </SortableContext>
              {!unscheduled.length && <p className="drawer-help">Nessuna idea in attesa. Aggiungine una da “Da pianificare”.</p>}
            </aside>}
          </DndContext>
          {!activeId && isMobile && <button type="button" className="planning-fab" onClick={() => setPlanningDrawer((value) => !value)} aria-expanded={planningDrawer}><Sparkles size={18} /> Da pianificare <span>{unscheduled.length}</span></button>}
        </section>
      )}

      {view === "planning" && (
        <>
          {sync.conflict && <div className="workspace-view conflict-wrap">{conflictBanner}</div>}
          <PlanningView
            activities={unscheduled}
            days={days}
            search={search}
            setSearch={setSearch}
            filter={filter}
            setFilter={setFilter}
            onOpen={openActivity}
            onNew={() => openNew(PLANNING_DAY_ID)}
            onSchedule={setScheduleTarget}
            editMode={canEdit}
            onToggleEditMode={() => setEditMode((value) => !value)}
            syncState={syncState}
          />
        </>
      )}

      {view === "trip" && (
        <>
          {sync.conflict && <div className="workspace-view conflict-wrap">{conflictBanner}</div>}
          <TripSummary
            trip={activeTrip}
            days={days}
            activities={activities}
            onReset={resetItinerary}
            onExport={exportJson}
            onImport={importJson}
            onShare={() => void shareTrip()}
            onInstall={() => void installApp()}
            onSettings={() => setSettingsOpen(true)}
            onUploadTicket={uploadTicket}
            settings={settings}
            syncState={syncState}
            isStandalone={isStandalone}
            canEdit={canEdit}
          />
        </>
      )}

      <nav className="mobile-nav" aria-label="Navigazione mobile">
        <NavButton icon={<ArrowLeft />} label="Viaggi" active={false} onClick={() => setView("trips")} />
        <NavButton icon={<HomeIcon />} label="Home" active={view === "home"} onClick={() => setView("home")} />
        <NavButton icon={<CalendarDays />} label="Itinerario" active={view === "itinerary"} onClick={() => setView("itinerary")} />
        <NavButton icon={<Sparkles />} label="Da pianificare" active={view === "planning"} onClick={() => setView("planning")} />
        <NavButton icon={<Route />} label="Riepilogo" active={view === "trip"} onClick={() => setView("trip")} />
      </nav>
      {tripEditor && <TripEditorDialog trip={tripEditor === "new" ? undefined : tripEditor} onClose={() => setTripEditor(null)} onSave={saveTrip} />}
      {tripToDelete && <DeleteTripDialog trip={tripToDelete} onClose={() => setTripToDelete(null)} onConfirm={deleteTrip} />}
      {settingsDialog}
      {scheduleTarget && <DayPickerDialog activity={scheduleTarget} days={days} lockedDays={lockedDays} onClose={() => setScheduleTarget(null)} onSelect={(dayId) => scheduleActivity(scheduleTarget, dayId)} />}
      {installDialogOpen && <InstallationDialog settings={settings} isIOS={isIOS} onClose={() => setInstallDialogOpen(false)} />}
      {draft && (
        <ActivityEditor
          activity={draft.activity}
          isNew={draft.isNew}
          readOnly={draft.readOnly}
          readOnlyReason={draft.reason}
          days={days}
          lockedDays={lockedDays}
          setActivity={(value) => setDraft((current) => {
            if (!current) return current;
            const nextActivity = typeof value === "function" ? value(current.activity) : value;
            return nextActivity ? { ...current, activity: nextActivity } : null;
          })}
          onClose={() => setDraft(null)}
          onSave={saveDraft}
          onDuplicate={duplicate}
          onDelete={remove}
          onMoveRelative={moveRelative}
          onUploadTicket={uploadTicket}
        />
      )}
      {toastNode}
    </main>
  );
}
