import { useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CalendarDays, ChevronRight, Edit3, LogOut, Plus, Settings, Smartphone, Sparkles, Trash2 } from "lucide-react";
import type { SiteSettings } from "../../shared/site-settings";
import { formatTripRange, generateTripDays, localDateKey, minutes, normalizeActivities, tripDayCount, tripTiming } from "../lib/activities";
import { api, siteAssetUrl } from "../lib/api";
import type { Activity, Trip } from "../lib/types";
import { BrandLogo, CoverImage } from "./ui";

export function TripsArchiveHome({ trips, loading, loadError, now, settings, onOpen, onNew, onEdit, onDelete, onInstall, onSettings, onCreateExample, onLogout, isStandalone, showLogout }: {
  trips: Trip[];
  loading: boolean;
  loadError: string;
  now: Date | null;
  settings: SiteSettings;
  onOpen: (trip: Trip) => void;
  onNew: () => void;
  onEdit: (trip: Trip) => void;
  onDelete: (trip: Trip) => void;
  onInstall: () => void;
  onSettings: () => void;
  onCreateExample: () => void;
  onLogout: () => void;
  isStandalone: boolean;
  showLogout: boolean;
}) {
  const today = now ? localDateKey(now) : localDateKey();
  const currentTrip = trips.find((trip) => tripTiming(trip, today) === "current");
  const tripsByYear = useMemo(() => {
    const groups = new Map<string, Trip[]>();
    [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach((trip) => {
      const year = trip.startDate.slice(0, 4);
      groups.set(year, [...(groups.get(year) ?? []), trip]);
    });
    return [...groups.entries()].sort(([a], [b]) => Number(b) - Number(a));
  }, [trips]);

  return (
    <section className="archive-home">
      <header className="archive-topbar">
        <div className="archive-wordmark"><BrandLogo settings={settings} /><div><strong>{settings.appName}</strong><span>{settings.appSubtitle}</span></div></div>
        <div className="archive-actions">
          {!isStandalone && <button type="button" className="archive-secondary install-archive-button" onClick={onInstall}><Smartphone /> Installa app</button>}
          <button type="button" className="archive-secondary settings-button" onClick={onSettings}><Settings /> Impostazioni</button>
          <button type="button" className="new-trip-button" onClick={onNew}><Plus /> Nuovo viaggio</button>
          {showLogout && <button type="button" className="archive-secondary logout-button" onClick={onLogout} aria-label="Esci" title="Esci"><LogOut /></button>}
        </div>
      </header>

      <div className="archive-heading">
        <div><h1>I nostri viaggi</h1><p>Ogni viaggio ha il suo itinerario, le sue foto e i suoi documenti, condivisi tra {settings.travellerOneName} e {settings.travellerTwoName}.</p></div>
        <div className="archive-polaroids" aria-label="I nostri ricordi">
          <figure><img src={siteAssetUrl("memory-one", settings.memoryOneVersion)} alt={settings.memoryOneCaption} /><figcaption>{settings.memoryOneCaption}</figcaption></figure>
          <figure><img src={siteAssetUrl("memory-two", settings.memoryTwoVersion)} alt={settings.memoryTwoCaption} /><figcaption>{settings.memoryTwoCaption}</figcaption></figure>
          <figure><img src={siteAssetUrl("memory-three", settings.memoryThreeVersion)} alt={settings.memoryThreeCaption} /><figcaption>{settings.memoryThreeCaption}</figcaption></figure>
        </div>
      </div>

      <div className="journey-years" aria-busy={loading}>
        {loadError && <p className="archive-error" role="alert">{loadError}</p>}
        {tripsByYear.map(([year, yearTrips]) => <section className="journey-year" key={year}>
          <header><h2>{year}</h2><span>{yearTrips.length} {yearTrips.length === 1 ? "viaggio" : "viaggi"}</span></header>
          <div className="journey-grid">
            {yearTrips.map((trip) => {
              const timing = tripTiming(trip, today);
              return <article key={trip.id} className={`journey-card is-${timing} ${timing === "current" ? "is-current" : ""}`}>
                <button type="button" className="journey-open" onClick={() => onOpen(trip)} aria-label={`Apri ${trip.title}`}>
                  <CoverImage src={trip.image} alt={`Foto di ${trip.destination}`} positionY={trip.imagePositionY} scale={trip.imageScale} />
                  <span className="journey-shade" />
                  <span className={`trip-timing-badge timing-${timing}`}><span />{timing === "current" ? "In corso" : timing === "upcoming" ? "In programma" : "Concluso"}</span>
                  <div className="journey-copy">
                    <p>{trip.destination}</p>
                    <h2>{trip.title}</h2>
                    <div><span><CalendarDays /> {formatTripRange(trip)}</span><span>{tripDayCount(trip)} giorni</span></div>
                  </div>
                  <span className="journey-arrow"><ChevronRight /></span>
                </button>
                <button type="button" className="journey-edit" onClick={() => onEdit(trip)} aria-label={`Modifica ${trip.title}`}><Edit3 /></button>
                <button type="button" className="journey-delete" onClick={() => onDelete(trip)} aria-label={`Elimina ${trip.title}`}><Trash2 /></button>
              </article>;
            })}
          </div>
        </section>)}
        <div className="new-journey-row">
          <button type="button" className="new-journey-card" onClick={onNew}><span><Plus /></span><strong>Crea un nuovo viaggio</strong><small>Aggiungi destinazione, date e foto di copertina</small></button>
          {!loading && !loadError && trips.length === 0 && <button type="button" className="new-journey-card example-card" onClick={onCreateExample}><span><Sparkles /></span><strong>Carica l’esempio Parigi 2026</strong><small>Crea il viaggio dimostrativo con l’itinerario iniziale dell’app. Non sono i vostri dati reali: per quelli usa “Importa viaggio” nelle impostazioni.</small></button>}
        </div>
      </div>

      <ArchiveTodayDock trip={currentTrip} trips={trips} today={today} onOpen={onOpen} />
    </section>
  );
}

function ArchiveTodayDock({ trip, trips, today, onOpen }: { trip?: Trip; trips: Trip[]; today: string; onOpen: (trip: Trip) => void }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const day = trip ? generateTripDays(trip).find((item) => item.date === today) : undefined;
  const tripId = trip?.id;
  const dayId = day?.id;
  const nextTrip = trips.filter((item) => item.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

  useEffect(() => {
    let cancelled = false;
    if (!tripId || !dayId) return;
    let firstLoad = true;
    async function loadToday() {
      if (firstLoad) setLoading(true);
      try {
        const { data } = await api<{ activities?: unknown }>(`/api/itinerary?tripId=${encodeURIComponent(tripId!)}`);
        const all = normalizeActivities(data.activities) ?? [];
        if (!cancelled) setItems(all.filter((activity) => activity.dayId === dayId).sort((a, b) => minutes(a.time) - minutes(b.time)));
      } catch { /* keep the last list */ }
      finally { if (!cancelled) setLoading(false); firstLoad = false; }
    }
    void loadToday();
    const interval = window.setInterval(() => void loadToday(), 8_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [tripId, dayId]);

  return (
    <aside className={`archive-today-dock ${trip ? "has-current-trip" : ""}`} aria-label="Itinerario di oggi">
      <div className="dock-heading"><span><CalendarCheck2 /></span><div><p>{trip ? "Itinerario di oggi" : "Oggi"}</p><strong>{trip ? `${trip.title} • ${day?.full ?? ""}` : "Nessun viaggio in corso"}</strong></div></div>
      {trip ? (
        <div className="dock-itinerary">
          {loading ? <small>Caricamento…</small> : items.length ? items.slice(0, 3).map((activity) => <div className="dock-activity" key={activity.id}><b>{activity.time}</b><span>{activity.title}</span></div>) : <small>Nessuna attività prevista per oggi.</small>}
          {items.length > 3 && <small>+{items.length - 3} altre tappe</small>}
        </div>
      ) : <p className="dock-next">{nextTrip ? `Prossimo viaggio: ${nextTrip.title}, ${formatTripRange(nextTrip)}` : "Crea il prossimo viaggio per iniziare a pianificarlo."}</p>}
      {trip && <button type="button" onClick={() => onOpen(trip)}>Apri giornata <ChevronRight /></button>}
    </aside>
  );
}
