import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, FileText, Lock, MapPin, Sparkles, Ticket, Trash2, Upload, X } from "lucide-react";
import { formatDuration, isValidTime } from "../lib/activities";
import { ticketUrl } from "../lib/api";
import { CATEGORIES, EMOJI, STATUSES } from "../lib/data";
import { PLANNING_DAY_ID, type Activity, type Category, type Day, type Status } from "../lib/types";
import { ActivityImage, Field } from "./ui";

const TICKET_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.pkpass,.ics,application/pdf,image/png,image/jpeg,image/webp,text/calendar,application/vnd.apple.pkpass";

function safeHttpUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function mapsUrlFor(activity: Activity) {
  const explicit = safeHttpUrl(activity.mapsLink);
  if (explicit) return explicit;
  const place = [activity.address, activity.area].filter(Boolean).join(", ") || activity.title;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
}

export function validateActivity(activity: Activity) {
  if (!activity.title.trim()) return "Inserisci un titolo";
  if (!isValidTime(activity.time)) return "Orario non valido: usa il formato HH:MM (es. 09:30)";
  if (!Number.isFinite(activity.duration) || activity.duration < 0 || activity.duration > 24 * 60) return "Durata non valida (minuti tra 0 e 1440)";
  if (!Number.isFinite(activity.cost) || activity.cost < 0) return "Il costo a persona non può essere negativo";
  if (activity.totalCost !== undefined && (!Number.isFinite(activity.totalCost) || activity.totalCost < 0)) return "Il costo totale non può essere negativo";
  if (activity.bookingLink && !safeHttpUrl(activity.bookingLink)) return "Il link di prenotazione deve iniziare con https://";
  if (activity.mapsLink && !safeHttpUrl(activity.mapsLink)) return "Il link di Maps deve iniziare con https://";
  return "";
}

export function ActivityEditor({ activity, isNew, readOnly, readOnlyReason, days, lockedDays, setActivity, onClose, onSave, onDuplicate, onDelete, onMoveRelative, onUploadTicket }: {
  activity: Activity;
  isNew: boolean;
  readOnly: boolean;
  readOnlyReason?: string;
  days: Day[];
  lockedDays: Set<string>;
  setActivity: React.Dispatch<React.SetStateAction<Activity | null>>;
  onClose: () => void;
  onSave: (activity: Activity) => void;
  onDuplicate: (activity: Activity) => void;
  onDelete: (activity: Activity) => void;
  onMoveRelative: (activity: Activity, direction: -1 | 1) => void;
  onUploadTicket: (activityId: string, file: File) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const update = <K extends keyof Activity>(key: K, value: Activity[K]) => setActivity((current) => current ? { ...current, [key]: value } : current);
  const dayLabel = activity.dayId === PLANNING_DAY_ID ? "Da pianificare" : days.find((day) => day.id === activity.dayId)?.full ?? "Fuori dalle date del viaggio";
  const bookingUrl = safeHttpUrl(activity.bookingLink);

  function save(next: Activity) {
    const problem = validateActivity(next);
    if (problem) { setError(problem); return; }
    setError("");
    onSave({ ...next, title: next.title.trim() });
  }

  async function uploadTicket(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (isNew) { setError("Salva l’attività prima di caricare il biglietto"); return; }
    setUploading(true);
    setError("");
    try { await onUploadTicket(activity.id, file); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Caricamento non riuscito"); }
    finally { setUploading(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <section className={`activity-editor ${readOnly ? "is-readonly" : ""}`} role="dialog" aria-modal="true" aria-labelledby="activity-editor-title">
        <header className="editor-header">
          <div><p className="section-kicker">{readOnly ? "Dettagli attività" : isNew ? "Nuova attività" : "Modifica rapida"}</p><h2 id="activity-editor-title">{activity.title || "Nuova attività"}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Chiudi" autoFocus><X /></button>
        </header>
        <div className="editor-content">
          {readOnly && <p className="readonly-note"><Lock size={15} /> {readOnlyReason ?? "Sola lettura"}</p>}
          <fieldset disabled={readOnly} className="editor-fieldset">
            <div className="image-controls-top">
              <Field label="URL immagine" wide><input type="url" value={activity.image ?? ""} onChange={(event) => update("image", event.target.value)} placeholder="https://" /></Field>
              <Field label={`Posizione verticale (${activity.imagePositionY ?? 50}%)`}><input type="range" min="0" max="100" value={activity.imagePositionY ?? 50} onChange={(event) => update("imagePositionY", Number(event.target.value))} /></Field>
              <Field label={`Zoom (${(activity.imageScale ?? 1).toFixed(2)}×)`}><input type="range" min="1" max="2" step="0.05" value={activity.imageScale ?? 1} onChange={(event) => update("imageScale", Number(event.target.value))} /></Field>
            </div>
            <div className="image-previews">
              <div className="closed-preview-group"><span>Card chiusa</span><div className="closed-card-preview"><div className="closed-image-preview"><ActivityImage activity={activity} /></div><div className="closed-card-copy"><b>{activity.time}</b><strong>{activity.title}</strong><small>{activity.category} · {formatDuration(activity.duration)}</small></div></div></div>
              <div><span>Card aperta</span><div className="editor-preview"><ActivityImage activity={activity} /><div><b aria-hidden="true">{EMOJI[activity.category]}</b><p>{dayLabel}</p></div></div></div>
            </div>
            <div className="form-grid">
              <Field label="Titolo" wide><input required maxLength={200} value={activity.title} onChange={(event) => update("title", event.target.value)} /></Field>
              <Field label="Giorno"><select value={activity.dayId} onChange={(event) => update("dayId", event.target.value)}>
                <option value={PLANNING_DAY_ID}>Da pianificare</option>
                {days.map((day) => <option key={day.id} value={day.id} disabled={lockedDays.has(day.id) && day.id !== activity.dayId}>{day.full}{lockedDays.has(day.id) ? " — bloccato" : ""}</option>)}
                {activity.dayId !== PLANNING_DAY_ID && !days.some((day) => day.id === activity.dayId) && <option value={activity.dayId}>Fuori dalle date ({activity.dayId})</option>}
              </select></Field>
              <Field label="Orario di inizio"><input type="time" required value={activity.time} aria-invalid={!isValidTime(activity.time)} onChange={(event) => update("time", event.target.value)} /></Field>
              <Field label="Durata (minuti)"><input type="number" min="0" max="1440" step="5" value={Number.isFinite(activity.duration) ? activity.duration : ""} onChange={(event) => update("duration", event.target.value === "" ? Number.NaN : Number(event.target.value))} /></Field>
              <Field label="Categoria"><select value={activity.category} onChange={(event) => update("category", event.target.value as Category)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Zona"><input maxLength={200} value={activity.area} onChange={(event) => update("area", event.target.value)} /></Field>
              <Field label="Indirizzo"><input maxLength={300} value={activity.address ?? ""} onChange={(event) => update("address", event.target.value)} /></Field>
              <Field label="Stato"><select value={activity.status} onChange={(event) => update("status", event.target.value as Status)}>{STATUSES.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Under 26"><select value={activity.under26 ? "yes" : "no"} onChange={(event) => update("under26", event.target.value === "yes" ? true : undefined)}><option value="no">No</option><option value="yes">Sì, riduzione disponibile</option></select></Field>
              <Field label="Costo a persona (€)"><input type="number" min="0" step="0.5" value={Number.isFinite(activity.cost) ? activity.cost : ""} onChange={(event) => update("cost", event.target.value === "" ? 0 : Number(event.target.value))} /></Field>
              <Field label="Costo totale coppia (€)" hint={`Vuoto = calcolo automatico (${(activity.cost * 2).toFixed(2).replace(".00", "")} €). 0 è un valore valido.`}><input type="number" min="0" step="0.5" placeholder={String(activity.cost * 2)} value={activity.totalCost ?? ""} onChange={(event) => update("totalCost", event.target.value === "" ? undefined : Number(event.target.value))} /></Field>
              <Field label="Descrizione" wide><textarea maxLength={2000} value={activity.description ?? ""} onChange={(event) => update("description", event.target.value)} /></Field>
              <Field label="Note" wide><textarea maxLength={2000} value={activity.note ?? ""} onChange={(event) => update("note", event.target.value)} /></Field>
              <Field label="Alternativa in caso di pioggia" wide><input maxLength={300} value={activity.rainAlternative ?? ""} onChange={(event) => update("rainAlternative", event.target.value)} /></Field>
              <Field label="Link prenotazione" wide><input type="url" value={activity.bookingLink ?? ""} onChange={(event) => update("bookingLink", event.target.value)} placeholder="https://" /></Field>
              <Field label="Link Google Maps" wide hint="Se vuoto, “Apri su Maps” cerca l’indirizzo o la zona."><input type="url" value={activity.mapsLink ?? ""} onChange={(event) => update("mapsLink", event.target.value)} placeholder="https://maps.google.com/…" /></Field>
            </div>
          </fieldset>
          <div className="field wide ticket-field">
            <span>Biglietto / prenotazione</span>
            {!readOnly && <label className={`ticket-file-field ${uploading ? "is-busy" : ""}`}><Upload /> {uploading ? "Caricamento…" : activity.ticket ? `Sostituisci ${activity.ticket.name}` : "Carica PDF, immagine, Wallet o calendario (max 15 MB)"}<input type="file" accept={TICKET_ACCEPT} disabled={uploading} onChange={(event) => void uploadTicket(event.currentTarget)} /></label>}
            {activity.ticket ? <a className="ticket-current" href={ticketUrl(activity.ticket.key)} target="_blank" rel="noreferrer"><FileText /> {activity.ticket.name} <ExternalLink /></a> : readOnly && <small className="field-hint">Nessun documento caricato</small>}
          </div>
          <div className="editor-links">
            <a className="maps-button" href={mapsUrlFor(activity)} target="_blank" rel="noreferrer"><MapPin /> Apri su Maps <ExternalLink /></a>
            {bookingUrl && <a className="maps-button" href={bookingUrl} target="_blank" rel="noreferrer"><Ticket /> Apri prenotazione <ExternalLink /></a>}
          </div>
          {!readOnly && !isNew && <div className="manual-move">
            <span>Comandi accessibili (alternativa al trascinamento)</span>
            <button type="button" onClick={() => onMoveRelative(activity, -1)}><ArrowUp /> Sposta su</button>
            <button type="button" onClick={() => onMoveRelative(activity, 1)}><ArrowDown /> Sposta giù</button>
            {activity.dayId !== PLANNING_DAY_ID && <button type="button" onClick={() => save({ ...activity, dayId: PLANNING_DAY_ID })}><Sparkles /> Sposta in “Da pianificare”</button>}
          </div>}
          {error && <p className="trip-form-error" role="alert">{error}</p>}
        </div>
        <footer className="editor-footer">
          {readOnly ? <button type="button" className="primary-button" onClick={onClose}><Check /> Chiudi</button> : <>
            {!isNew && <button type="button" className="danger-link" onClick={() => onDelete(activity)} aria-label="Elimina attività"><Trash2 /> Elimina</button>}
            {!isNew && <button type="button" className="secondary-button" onClick={() => onDuplicate(activity)} aria-label="Duplica attività"><Copy /> Duplica</button>}
            <button type="button" className="primary-button" onClick={() => save(activity)}><Check /> {isNew ? "Crea attività" : "Salva attività"}</button>
          </>}
        </footer>
      </section>
    </div>
  );
}
