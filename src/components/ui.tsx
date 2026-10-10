import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Cloud, CloudOff, LoaderCircle } from "lucide-react";
import type { SiteSettings } from "../../shared/site-settings";
import { normalizeImageUrl } from "../lib/activities";
import { siteAssetUrl } from "../lib/api";
import { ACTIVITY_IMAGES, CATEGORY_IMAGES } from "../lib/data";
import type { Activity, SyncState } from "../lib/types";

export function SyncBadge({ state, detail }: { state: SyncState; detail?: string }) {
  const content = state === "saving"
    ? { icon: <LoaderCircle />, label: "Salvataggio…" }
    : state === "offline"
      ? { icon: <CloudOff />, label: "Non sincronizzato" }
      : state === "loading"
        ? { icon: <LoaderCircle />, label: "Caricamento…" }
        : { icon: <Cloud />, label: "Sincronizzato" };

  return <div className={`sync-badge sync-${state}`} role="status" title={state === "offline" ? detail || "Le modifiche restano su questo dispositivo finché la connessione non torna" : undefined}>{content.icon}<span>{content.label}</span></div>;
}

export function ActivityImage({ activity, className = "" }: { activity: Activity; className?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const customImage = normalizeImageUrl(activity.image);
  const specificImage = customImage || ACTIVITY_IMAGES[activity.id];
  const source = specificImage && failedSource !== specificImage ? specificImage : CATEGORY_IMAGES[activity.category] ?? CATEGORY_IMAGES.Attrazione;
  return <img
    className={`activity-image ${className}`}
    style={{ objectPosition: `center ${activity.imagePositionY ?? 50}%`, transform: `scale(${activity.imageScale ?? 1})` }}
    src={source}
    alt=""
    loading="lazy"
    onError={() => { if (source === specificImage) setFailedSource(source); }}
  />;
}

/** Trip cover with a neutral fallback when the remote photo is unavailable. */
export function CoverImage({ src, alt, positionY = 50, scale = 1, className }: { src: string; alt: string; positionY?: number; scale?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    return <div className={`cover-fallback ${className ?? ""}`} role="img" aria-label={alt}><ImagePlaceholder /></div>;
  }
  return <img className={className} style={{ objectPosition: `center ${positionY}%`, transform: `scale(${scale})` }} src={src} alt={alt} onError={() => setFailed(src)} />;
}

export function CoupleAvatars({ settings }: { settings: SiteSettings }) {
  return (
    <div className="mini-avatars" aria-label={`${settings.travellerOneName} e ${settings.travellerTwoName}`}>
      <img src={siteAssetUrl("traveller-one", settings.travellerOnePhotoVersion)} alt={settings.travellerOneName} />
      <img src={siteAssetUrl("traveller-two", settings.travellerTwoPhotoVersion)} alt={settings.travellerTwoName} />
    </div>
  );
}

/**
 * The logo is shown free: no box, border, background or shadow, always
 * object-fit: contain. Size comes only from the .me-monogram variants.
 */
export function BrandLogo({ settings, large = false }: { settings: SiteSettings; large?: boolean }) {
  return <div className={`me-monogram ${large ? "large" : ""}`} role="img" aria-label={`Logo ${settings.appName}`}>
    <img src={siteAssetUrl("logo", settings.logoVersion)} alt="" />
  </div>;
}

export function ImagePlaceholder() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="9" cy="9" r="1.6" fill="currentColor" /><path d="m5 18 4.6-4.8 3.2 3 2.4-2.5L20 18" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

export function Field({ label, wide = false, hint, children }: { label: string; wide?: boolean; hint?: string; children: ReactNode }) {
  return <label className={wide ? "field wide" : "field"}><span>{label}</span>{children}{hint && <small className="field-hint">{hint}</small>}</label>;
}

export function SummaryStat({ icon, value, label, accent = false }: { icon: ReactNode; value: string; label: string; accent?: boolean }) {
  return <div className={`summary-stat ${accent ? "accent" : ""}`}><span>{icon}</span><strong>{value}</strong><small>{label}</small></div>;
}

export function TripCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <article className="trip-card"><header><span>{icon}</span><h2>{title}</h2></header><div>{children}</div></article>;
}

export function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return <p className="info-line"><span>{label}</span><strong>{value}</strong></p>;
}

export function NavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} onClick={onClick} aria-label={label} aria-current={active ? "page" : undefined} title={label}>{icon}<span>{label}</span></button>;
}

export function Stat({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return <div className={accent ? "stat accent" : "stat"}><strong>{value}</strong><span>{label}</span></div>;
}

export type ToastMessage = { text: string; tone: "info" | "error"; undo?: boolean };

export function Toast({ toast, onUndo }: { toast: ToastMessage; onUndo?: () => void }) {
  return <div className={`toast ${toast.tone === "error" ? "toast-error" : ""}`} role={toast.tone === "error" ? "alert" : "status"}>
    {toast.tone === "error" ? <AlertTriangle size={16} /> : <Check size={16} />} <span>{toast.text}</span>
    {toast.undo && onUndo && <button type="button" onClick={onUndo}>Annulla</button>}
  </div>;
}
