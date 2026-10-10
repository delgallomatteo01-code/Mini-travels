import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronRight, Cloud, Download, KeyRound, LoaderCircle, Lock, Share2, Trash2, Upload, X } from "lucide-react";
import type { SiteAssetKind, SiteSettings } from "../../shared/site-settings";
import { tripDayCount } from "../lib/activities";
import { api, siteAssetUrl } from "../lib/api";
import type { Activity, Day, Trip, TripInput } from "../lib/types";
import { CoverImage, Field, ImagePlaceholder } from "./ui";

/** Closes on Escape and keeps keyboard focus inside the dialog while open. */
function useDialogKeys(onClose: () => void, enabled = true) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = () => [...(node?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex='-1'])") ?? [])]
      .filter((element) => element.offsetParent !== null || element.getClientRects().length > 0);
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()[0];
    first?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.({ preventScroll: true }); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return ref;
}

function Backdrop({ className = "", onClose, children }: { className?: string; onClose: () => void; children: ReactNode }) {
  return <div className={`modal-backdrop ${className}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>{children}</div>;
}

export function TripEditorDialog({ trip, onClose, onSave }: { trip?: Trip; onClose: () => void; onSave: (input: TripInput) => Promise<void> }) {
  const [form, setForm] = useState<TripInput>(() => trip ? {
    title: trip.title,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    image: trip.image,
    imagePositionY: trip.imagePositionY ?? 50,
    imageScale: trip.imageScale ?? 1,
  } : { title: "", destination: "", startDate: "", endDate: "", image: "", imagePositionY: 50, imageScale: 1 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ref = useDialogKeys(onClose);
  const update = (key: keyof TripInput, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  const datesInvalid = Boolean(form.startDate && form.endDate && form.endDate < form.startDate);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (datesInvalid) { setError("La data di ritorno non può precedere la partenza"); return; }
    setSaving(true);
    setError("");
    try { await onSave(form); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Impossibile salvare il viaggio"); setSaving(false); }
  }

  return (
    <Backdrop className="trip-editor-backdrop" onClose={onClose}>
      <form ref={ref as React.RefObject<HTMLFormElement>} className="trip-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="trip-editor-title" onSubmit={(event) => void submit(event)}>
        <header><div><p className="section-kicker">{trip ? "Modifica viaggio" : "Nuovo viaggio"}</p><h2 id="trip-editor-title">{trip ? trip.title : "Dove andiamo?"}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Chiudi"><X /></button></header>
        <div className="trip-cover-preview">{form.image ? <CoverImage src={form.image} alt="Anteprima copertina" positionY={form.imagePositionY} scale={form.imageScale} /> : <div><ImagePlaceholder /><span>La foto del viaggio apparirà qui</span></div>}<span className="trip-preview-shade" /><strong>{form.title || "Nome del viaggio"}</strong></div>
        <div className="form-grid trip-form-grid">
          <Field label="Nome del viaggio" wide><input data-autofocus required maxLength={120} value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="es. LISBONA 2027" /></Field>
          <Field label="Destinazione" wide><input required maxLength={120} value={form.destination} onChange={(event) => update("destination", event.target.value)} placeholder="Città, Paese" /></Field>
          <Field label="Data di partenza"><input required type="date" value={form.startDate} onChange={(event) => update("startDate", event.target.value)} /></Field>
          <Field label="Data di ritorno"><input required type="date" min={form.startDate || undefined} value={form.endDate} aria-invalid={datesInvalid} onChange={(event) => update("endDate", event.target.value)} /></Field>
          <Field label="URL foto di copertina" wide hint="Incolla il link di una foto (https://…). Puoi regolarne posizione e zoom qui sotto."><input required type="url" value={form.image} onChange={(event) => update("image", event.target.value)} placeholder="https://…" /></Field>
          <Field label={`Posizione verticale (${form.imagePositionY}%)`}><input type="range" min="0" max="100" value={form.imagePositionY} onChange={(event) => update("imagePositionY", Number(event.target.value))} /></Field>
          <Field label={`Zoom copertina (${form.imageScale.toFixed(2)}×)`}><input type="range" min="1" max="2" step="0.05" value={form.imageScale} onChange={(event) => update("imageScale", Number(event.target.value))} /></Field>
        </div>
        {trip && form.startDate && form.endDate && !datesInvalid && tripDayCount(form) !== tripDayCount(trip) && <p className="form-note">Le attività dei giorni che escono dal nuovo intervallo non vengono cancellate: le troverai in “Da pianificare” con l’indicazione “fuori date”.</p>}
        {(error || datesInvalid) && <p className="trip-form-error" role="alert">{error || "La data di ritorno non può precedere la partenza"}</p>}
        <footer><button type="button" className="secondary-button" onClick={onClose}>Annulla</button><button className="primary-button" disabled={saving || datesInvalid}>{saving ? <LoaderCircle /> : <Check />} {saving ? "Salvataggio…" : trip ? "Salva modifiche" : "Crea viaggio"}</button></footer>
      </form>
    </Backdrop>
  );
}

export function DeleteTripDialog({ trip, onClose, onConfirm }: { trip: Trip; onClose: () => void; onConfirm: (trip: Trip) => Promise<void> }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const close = () => { if (!deleting) onClose(); };
  const ref = useDialogKeys(close);
  async function removeTrip() {
    setDeleting(true);
    setError("");
    try { await onConfirm(trip); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossibile eliminare il viaggio");
      setDeleting(false);
    }
  }
  return (
    <Backdrop className="delete-trip-backdrop" onClose={close}>
      <section ref={ref} className="delete-trip-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-trip-title" aria-describedby="delete-trip-description">
        <span className="delete-trip-icon"><Trash2 /></span>
        <p className="section-kicker">Elimina viaggio</p>
        <h2 id="delete-trip-title">Eliminare {trip.title}?</h2>
        <p id="delete-trip-description">Verranno rimossi definitivamente la card, l’itinerario e tutti i biglietti caricati per questo viaggio. Gli altri viaggi non vengono toccati.</p>
        {error && <p className="trip-form-error" role="alert">{error}</p>}
        <footer>
          <button type="button" className="secondary-button" disabled={deleting} onClick={onClose} data-autofocus>Annulla</button>
          <button type="button" className="delete-confirm-button" disabled={deleting} onClick={() => void removeTrip()}>{deleting ? <LoaderCircle /> : <Trash2 />} {deleting ? "Eliminazione…" : "Elimina definitivamente"}</button>
        </footer>
      </section>
    </Backdrop>
  );
}

/**
 * PWA icons are separate derivatives: the logo is centered on the icon
 * background. The original upload is stored untouched (transparency included).
 */
async function rasterizeLogoIcon(file: File, size: number, background: string) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Logo non leggibile: usa un SVG o un PNG valido"));
      element.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossibile generare l’icona");
    context.fillStyle = background;
    context.fillRect(0, 0, size, size);
    const naturalWidth = image.naturalWidth || size;
    const naturalHeight = image.naturalHeight || size;
    const ratio = Math.min((size * .7) / naturalWidth, (size * .7) / naturalHeight);
    const width = naturalWidth * ratio;
    const height = naturalHeight * ratio;
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Impossibile generare l’icona");
    return new File([blob], `app-icon-${size}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const COLOR_FIELDS: Array<[keyof SiteSettings, string]> = [
  ["accentColor", "Colore di accento"], ["secondaryAccentColor", "Accento secondario"], ["backgroundColor", "Sfondo"],
  ["cardColor", "Card"], ["textColor", "Testo"], ["mutedColor", "Testo secondario"],
];

export function SettingsDialog({ settings, onClose, onSave, onUpload, onImportFile, onDownloadBackup }: {
  settings: SiteSettings;
  onClose: () => void;
  onSave: (settings: SiteSettings) => Promise<void>;
  onUpload: (kind: SiteAssetKind, file: File, extra?: File[]) => Promise<SiteSettings>;
  onImportFile: (file: File) => Promise<string>;
  onDownloadBackup: () => Promise<void>;
}) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<SiteAssetKind | null>(null);
  const [error, setError] = useState("");
  const [transferMessage, setTransferMessage] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const ref = useDialogKeys(onClose);
  const update = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => setForm((current) => ({ ...current, [key]: value }));
  const uploadLabels: Array<{ kind: SiteAssetKind; label: string; hint: string; version: number; accept: string }> = [
    { kind: "logo", label: "Logo e icona app", hint: "SVG (max 1 MB) o PNG trasparente (max 8 MB)", version: form.logoVersion, accept: ".svg,.png,image/svg+xml,image/png" },
    { kind: "traveller-one", label: `Foto profilo ${form.travellerOneName}`, hint: "JPG, PNG o WebP fino a 8 MB", version: form.travellerOnePhotoVersion, accept: "image/jpeg,image/png,image/webp" },
    { kind: "traveller-two", label: `Foto profilo ${form.travellerTwoName}`, hint: "JPG, PNG o WebP fino a 8 MB", version: form.travellerTwoPhotoVersion, accept: "image/jpeg,image/png,image/webp" },
    { kind: "memory-one", label: "Polaroid 1", hint: "Foto mostrata nell’archivio", version: form.memoryOneVersion, accept: "image/jpeg,image/png,image/webp" },
    { kind: "memory-two", label: "Polaroid 2", hint: "Foto mostrata nell’archivio", version: form.memoryTwoVersion, accept: "image/jpeg,image/png,image/webp" },
    { kind: "memory-three", label: "Polaroid 3", hint: "Foto mostrata nell’archivio", version: form.memoryThreeVersion, accept: "image/jpeg,image/png,image/webp" },
  ];

  async function upload(kind: SiteAssetKind, input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setError("");
    setUploading(kind);
    try {
      let saved: SiteSettings;
      if (kind === "logo") {
        const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
        const isPng = !isSvg && (file.type === "image/png" || file.name.toLowerCase().endsWith(".png"));
        if ((!isSvg && !isPng) || file.size > (isSvg ? 1024 * 1024 : 8 * 1024 * 1024)) {
          throw new Error("Usa un SVG entro 1 MB o un PNG entro 8 MB");
        }
        const [icon192, icon512] = await Promise.all([
          rasterizeLogoIcon(file, 192, form.backgroundColor),
          rasterizeLogoIcon(file, 512, form.backgroundColor),
        ]);
        saved = await onUpload(kind, file, [icon192, icon512]);
      } else {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error("Usa JPG, PNG o WebP entro 8 MB");
        saved = await onUpload(kind, file);
      }
      // Refresh the previews at once; texts and colours being edited are kept.
      setForm((current) => ({
        ...current,
        logoVersion: saved.logoVersion,
        travellerOnePhotoVersion: saved.travellerOnePhotoVersion,
        travellerTwoPhotoVersion: saved.travellerTwoPhotoVersion,
        memoryOneVersion: saved.memoryOneVersion,
        memoryTwoVersion: saved.memoryTwoVersion,
        memoryThreeVersion: saved.memoryThreeVersion,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Caricamento non riuscito");
    } finally { setUploading(null); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try { await onSave(form); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito"); }
    finally { setSaving(false); }
  }

  async function importFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setTransferBusy(true);
    setTransferMessage("");
    try { setTransferMessage(await onImportFile(file)); }
    catch (reason) { setTransferMessage(reason instanceof Error ? reason.message : "Importazione non riuscita"); }
    finally { setTransferBusy(false); }
  }

  async function backup() {
    setTransferBusy(true);
    setTransferMessage("");
    try { await onDownloadBackup(); setTransferMessage("Backup scaricato. Contiene viaggi, itinerari e impostazioni, ma non i file caricati (biglietti e foto)."); }
    catch (reason) { setTransferMessage(reason instanceof Error ? reason.message : "Backup non riuscito"); }
    finally { setTransferBusy(false); }
  }

  return <Backdrop className="settings-backdrop" onClose={onClose}>
    <form ref={ref as React.RefObject<HTMLFormElement>} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onSubmit={(event) => void submit(event)}>
      <header><div><p className="section-kicker">Personalizzazione completa</p><h2 id="settings-title">Impostazioni</h2><span>Le modifiche vengono salvate sul server e valgono su tutti i dispositivi.</span></div><button type="button" className="icon-button" onClick={onClose} aria-label="Chiudi"><X /></button></header>
      <div className="settings-content">
        <section className="settings-section"><div className="settings-section-title"><strong>Identità</strong><span>Nome dell’app e persone</span></div><div className="form-grid">
          <Field label="Nome app"><input maxLength={42} value={form.appName} onChange={(event) => update("appName", event.target.value)} /></Field>
          <Field label="Sottotitolo"><input maxLength={80} value={form.appSubtitle} onChange={(event) => update("appSubtitle", event.target.value)} /></Field>
          <Field label="Nome persona 1"><input maxLength={80} value={form.travellerOneName} onChange={(event) => update("travellerOneName", event.target.value)} /></Field>
          <Field label="Nome persona 2"><input maxLength={80} value={form.travellerTwoName} onChange={(event) => update("travellerTwoName", event.target.value)} /></Field>
        </div></section>

        <section className="settings-section"><div className="settings-section-title"><strong>Colori</strong><span>Palette globale: predefinita bianco, nero e verde #528019</span></div><div className="color-settings-grid">
          {COLOR_FIELDS.map(([key, label]) => <label className="color-field" key={key}><span>{label}</span><div><input type="color" value={String(form[key])} onChange={(event) => update(key, event.target.value as never)} /><code>{String(form[key]).toUpperCase()}</code></div></label>)}
        </div></section>

        <section className="settings-section"><div className="settings-section-title"><strong>Logo e fotografie</strong><span>SVG o PNG trasparente, senza cornice. Le icone dell’app vengono create automaticamente.</span></div><div className="asset-settings-grid">
          {uploadLabels.map((asset) => <label className={`asset-upload ${uploading === asset.kind ? "is-uploading" : ""}`} key={asset.kind}>
            <span className={`asset-preview ${asset.kind === "logo" ? "logo-preview" : ""}`}><img src={siteAssetUrl(asset.kind, asset.version)} alt="" /></span>
            <span className="asset-copy"><strong>{asset.label}</strong><small>{uploading === asset.kind ? "Caricamento…" : asset.hint}</small></span>
            <span className="asset-action">{uploading === asset.kind ? <LoaderCircle /> : <Upload />} Sostituisci</span>
            <input type="file" accept={asset.accept} disabled={Boolean(uploading)} onChange={(event) => void upload(asset.kind, event.currentTarget)} />
          </label>)}
        </div></section>

        <section className="settings-section"><div className="settings-section-title"><strong>Didascalie polaroid</strong><span>Testi sotto le foto dell’archivio</span></div><div className="form-grid">
          <Field label="Polaroid 1"><input maxLength={80} value={form.memoryOneCaption} onChange={(event) => update("memoryOneCaption", event.target.value)} /></Field>
          <Field label="Polaroid 2"><input maxLength={80} value={form.memoryTwoCaption} onChange={(event) => update("memoryTwoCaption", event.target.value)} /></Field>
          <Field label="Polaroid 3" wide><input maxLength={80} value={form.memoryThreeCaption} onChange={(event) => update("memoryThreeCaption", event.target.value)} /></Field>
        </div></section>

        <section className="settings-section"><div className="settings-section-title"><strong>Trasferimento dati</strong><span>Migrazione dal vecchio sito e backup</span></div>
          <p className="settings-help">“Importa viaggio” crea un <b>nuovo</b> viaggio da un file esportato (“Esporta JSON” del vecchio sito, formato <code>{"{ trip, activities }"}</code>) o da un backup completo di questa app. Non modifica né cancella i viaggi esistenti. I biglietti non sono contenuti nel JSON: andranno ricaricati dalle rispettive attività.</p>
          <div className="tool-buttons settings-tools">
            <label className={transferBusy ? "is-busy" : ""}><Upload /> Importa viaggio (JSON)<input type="file" accept="application/json,.json" disabled={transferBusy} onChange={(event) => void importFile(event.currentTarget)} /></label>
            <button type="button" disabled={transferBusy} onClick={() => void backup()}><Download /> Scarica backup completo</button>
          </div>
          {transferMessage && <p className="settings-transfer-message" role="status">{transferMessage}</p>}
        </section>
      </div>
      {error && <p className="trip-form-error settings-error" role="alert">{error}</p>}
      <footer><button type="button" className="secondary-button" onClick={onClose}>Annulla</button><button className="primary-button" disabled={saving || Boolean(uploading)}>{saving ? <LoaderCircle /> : <Check />} {saving ? "Salvataggio…" : "Salva impostazioni"}</button></footer>
    </form>
  </Backdrop>;
}

export function InstallationDialog({ settings, isIOS, onClose }: { settings: SiteSettings; isIOS: boolean; onClose: () => void }) {
  const ref = useDialogKeys(onClose);
  return (
    <Backdrop className="install-backdrop" onClose={onClose}>
      <section ref={ref} className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <header>
          <div className="install-icon"><img src={siteAssetUrl("logo", settings.logoVersion)} alt={`Logo ${settings.appName}`} /></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Chiudi"><X /></button>
        </header>
        <p className="section-kicker">{isIOS ? "App per iPhone" : "App per smartphone e computer"}</p>
        <h2 id="install-title">Installa {settings.appName}</h2>
        {isIOS ? (
          <ol>
            <li><span><Share2 /></span><div><strong>Tocca Condividi</strong><p>Usa l’icona Condividi nella barra di Safari.</p></div></li>
            <li><span className="install-step-number">2</span><div><strong>Aggiungi alla schermata Home</strong><p>Scorri il menu e seleziona questa voce.</p></div></li>
            <li><span className="install-step-number">3</span><div><strong>Conferma con “Aggiungi”</strong><p>L’app comparirà insieme alle altre app dell’iPhone.</p></div></li>
          </ol>
        ) : (
          <p className="install-generic">Su Android (Chrome) apri il menu ⋮ e scegli <strong>Installa app</strong> o <strong>Aggiungi a schermata Home</strong>. Su computer usa l’icona di installazione nella barra degli indirizzi.</p>
        )}
        <div className="install-sync-note"><Cloud /><p><strong>Stessi dati su ogni dispositivo.</strong><br />{settings.appSubtitle} vedono le stesse modifiche quando sono online. L’app installata richiede comunque la connessione per sincronizzare.</p></div>
        <button type="button" className="primary-button install-done" onClick={onClose}>Ho capito</button>
      </section>
    </Backdrop>
  );
}

export function DayPickerDialog({ activity, days, lockedDays, onClose, onSelect }: { activity: Activity; days: Day[]; lockedDays: Set<string>; onClose: () => void; onSelect: (dayId: string) => void }) {
  const ref = useDialogKeys(onClose);
  return (
    <Backdrop onClose={onClose}>
      <section ref={ref} className="day-picker" role="dialog" aria-modal="true" aria-label={`Scegli il giorno per ${activity.title}`}>
        <div className="sheet-handle" />
        <header>
          <div><p className="section-kicker">Aggiungi all’itinerario</p><h2>In che giorno?</h2><span>{activity.title}</span></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Chiudi"><X /></button>
        </header>
        <div className="day-picker-list">
          {days.map((day) => <button type="button" key={day.id} disabled={lockedDays.has(day.id)} onClick={() => onSelect(day.id)}><span>{day.tab}</span><div><strong>{day.full}</strong><small>{lockedDays.has(day.id) ? "Giornata bloccata" : day.theme}</small></div>{lockedDays.has(day.id) ? <Lock /> : <ChevronRight />}</button>)}
        </div>
      </section>
    </Backdrop>
  );
}

export function LoginScreen({ appName, configured, onLoggedIn }: { appName: string; configured: boolean; onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      onLoggedIn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Accesso non riuscito");
    } finally { setBusy(false); }
  }
  return <main className="login-shell">
    <form className="login-card" onSubmit={(event) => void submit(event)}>
      <div className="me-monogram large"><img src="/api/site-assets?kind=logo" alt="" /></div>
      <p className="section-kicker">Area riservata</p>
      <h1>{appName}</h1>
      {configured ? <>
        <p className="login-help">Inserisci la password condivisa per vedere e modificare i viaggi.</p>
        <Field label="Password"><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></Field>
        {error && <p className="trip-form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" disabled={busy || !password}>{busy ? <LoaderCircle /> : <KeyRound />} Entra</button>
      </> : <p className="trip-form-error" role="alert">Il server non ha ancora una password: imposta <code>APP_PASSWORD</code> (vedi README) e ricarica la pagina.</p>}
    </form>
  </main>;
}
