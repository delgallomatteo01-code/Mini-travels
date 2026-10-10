import type { ChangeEvent } from "react";
import { CalendarCheck2, CalendarDays, Download, Euro, FileText, Heart, Info, Printer, RotateCcw, Route, Settings, Share2, Smartphone, Upload, Users } from "lucide-react";
import type { SiteSettings } from "../../shared/site-settings";
import { CONFIRMED_STATUSES, costTotals, formatEuro, formatTripDate, formatTripRange, minutes, scheduledActivities, tripDayCount } from "../lib/activities";
import { ticketUrl } from "../lib/api";
import { PLANNING_DAY_ID, type Activity, type Day, type SyncState, type Trip } from "../lib/types";
import { TicketPreview } from "./Itinerary";
import { BrandLogo, CoverImage, InfoLine, SummaryStat, SyncBadge, TripCard } from "./ui";

const TICKET_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.pkpass,.ics,application/pdf,image/png,image/jpeg,image/webp,text/calendar,application/vnd.apple.pkpass";

export function TripSummary({ trip, days, activities, onReset, onExport, onImport, onShare, onInstall, onSettings, onUploadTicket, settings, syncState, isStandalone, canEdit }: {
  trip: Trip;
  days: Day[];
  activities: Activity[];
  onReset: () => void;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onShare: () => void;
  onInstall: () => void;
  onSettings: () => void;
  onUploadTicket: (activityId: string, file: File) => Promise<void>;
  settings: SiteSettings;
  syncState: SyncState;
  isStandalone: boolean;
  canEdit: boolean;
}) {
  // Every figure is derived from the activities: nothing is typed by hand.
  const dayOrder = new Map(days.map((day, index) => [day.id, index]));
  const planned = scheduledActivities(activities, days).sort((a, b) => (dayOrder.get(a.dayId)! - dayOrder.get(b.dayId)!) || minutes(a.time) - minutes(b.time));
  const confirmed = planned.filter((activity) => CONFIRMED_STATUSES.includes(activity.status)).length;
  const toReserve = planned.filter((activity) => activity.status === "Da prenotare");
  const { perPerson, couple } = costTotals(activities, days);
  const transports = planned.filter((activity) => ["Volo", "Navetta", "Trasporto"].includes(activity.category));
  const notes = planned.filter((activity) => activity.note?.trim());
  const withTickets = activities.filter((activity) => activity.ticket);
  const activityDay = (activity: Activity) => activity.dayId === PLANNING_DAY_ID ? "Da pianificare" : days.find((day) => day.id === activity.dayId)?.tab ?? "Fuori date";

  return (
    <section className="workspace-view trip-view">
      <header className="workspace-header">
        <div><p className="section-kicker">Tutto in un posto</p><h1>{trip.title}</h1></div>
        <div className="header-actions trip-header-actions">
          <SyncBadge state={syncState} />
          <button type="button" className="mode-button" onClick={onShare}><Share2 size={16} /> Condividi</button>
          <button type="button" className="mode-button summary-settings-button" onClick={onSettings}><Settings size={16} /> Impostazioni</button>
        </div>
      </header>
      <div className="summary-hero">
        <div className="summary-copy"><BrandLogo settings={settings} large /><p>{settings.appSubtitle}</p><h2>{trip.destination}</h2><span>{formatTripRange(trip)} • {tripDayCount(trip)} giorni</span></div>
        <div className="summary-cover"><CoverImage src={trip.image} alt={`Copertina ${trip.title}`} positionY={trip.imagePositionY} scale={trip.imageScale} /></div>
      </div>
      <div className="summary-stats">
        <SummaryStat icon={<CalendarCheck2 />} value={String(confirmed)} label="attività confermate" />
        <SummaryStat icon={<Info />} value={String(toReserve.length)} label="ancora da prenotare" accent />
        <SummaryStat icon={<Euro />} value={formatEuro(perPerson)} label="stima a persona" />
        <SummaryStat icon={<Users />} value={formatEuro(couple)} label="stima della coppia" />
      </div>
      <section className="tickets-section">
        <header><div><p className="section-kicker">Documenti di viaggio</p><h2>Tutti i biglietti</h2><p>Carica i documenti dalla relativa attività; qui puoi aprirli, scaricarli o sostituirli.</p></div></header>
        <div className="tickets-grid">
          {withTickets.map((activity) => {
            const url = ticketUrl(activity.ticket!.key);
            const open = () => window.open(url, "_blank", "noopener,noreferrer");
            return <article className="ticket-card has-ticket" key={activity.id} role="link" tabIndex={0} aria-label={`Apri ${activity.ticket!.name}`} onClick={open} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); open(); } }}>
              <div className="ticket-visual"><TicketPreview ticket={activity.ticket!} /></div>
              <div className="ticket-card-body"><strong>{activity.title}</strong><small>{activityDay(activity)} • {activity.ticket!.name}</small><div className="ticket-actions">
                {canEdit && <label onClick={(event) => event.stopPropagation()}><Upload /> Sostituisci<input type="file" accept={TICKET_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onUploadTicket(activity.id, file).catch(() => undefined); event.currentTarget.value = ""; }} /></label>}
                <a href={url} download={activity.ticket!.name} onClick={(event) => event.stopPropagation()} aria-label={`Scarica ${activity.ticket!.name}`}><Download /></a>
              </div></div>
            </article>;
          })}
          {!withTickets.length && <div className="tickets-empty"><FileText /><span>Carica un biglietto dalla relativa attività per trovarlo qui.</span></div>}
        </div>
      </section>
      <div className="trip-grid">
        <TripCard icon={<CalendarDays />} title="Date e destinazione">
          <InfoLine label="Destinazione" value={trip.destination} />
          <InfoLine label="Partenza" value={formatTripDate(trip.startDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />
          <InfoLine label="Ritorno" value={formatTripDate(trip.endDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />
          <InfoLine label="Durata" value={`${tripDayCount(trip)} giorni • ${planned.length} tappe`} />
        </TripCard>
        <TripCard icon={<Info />} title="Da prenotare">
          {toReserve.length ? toReserve.map((activity) => <InfoLine key={activity.id} label={activityDay(activity)} value={`${activity.time} • ${activity.title}${activity.cost ? ` • ${formatEuro(activity.cost)}` : ""}`} />) : <p className="card-note">Non ci sono prenotazioni in sospeso.</p>}
        </TripCard>
        <TripCard icon={<Route />} title="Trasporti">
          {transports.length ? transports.map((activity) => <InfoLine key={activity.id} label={activityDay(activity)} value={`${activity.time} • ${activity.title}`} />) : <p className="card-note">Aggiungi voli, navette o altri trasporti dall’itinerario.</p>}
        </TripCard>
        <TripCard icon={<Heart />} title="Note importanti">
          {notes.length ? notes.map((activity) => <InfoLine key={activity.id} label={activity.title} value={activity.note!} />) : <p className="card-note">Le note aggiunte alle attività compariranno qui.</p>}
        </TripCard>
      </div>
      <section className="data-tools">
        <div>
          <p className="section-kicker">Gestione dati</p>
          <h2>Itinerario condiviso</h2>
          <p>Le modifiche vengono salvate sul server e compaiono sugli altri dispositivi entro pochi secondi. Il badge indica lo stato reale: “Non sincronizzato” significa che le ultime modifiche sono solo su questo dispositivo.</p>
          <SyncBadge state={syncState} />
          <p className="data-tools-note">L’esportazione JSON contiene viaggio e attività con i riferimenti ai biglietti, ma <b>non i file dei biglietti</b>. “Importa JSON” sostituisce le attività di <b>questo</b> viaggio (gli altri viaggi non cambiano).</p>
        </div>
        <div className="tool-buttons">
          {!isStandalone && <button type="button" onClick={onInstall}><Smartphone /> Installa app</button>}
          <button type="button" onClick={onExport}><Download /> Esporta JSON</button>
          <label className={canEdit ? "" : "is-disabled"} aria-disabled={!canEdit}><Upload /> Importa JSON<input type="file" accept="application/json,.json" disabled={!canEdit} onChange={onImport} /></label>
          <button type="button" onClick={() => window.print()}><Printer /> Stampa</button>
          <button type="button" className="danger-button" disabled={!canEdit} onClick={onReset}><RotateCcw /> Ripristina</button>
        </div>
      </section>
    </section>
  );
}
