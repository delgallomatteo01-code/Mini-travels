import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarPlus, Clock3, FileText, GripVertical, Info, Lock, MapPin, RotateCcw, Trash2, Unlock } from "lucide-react";
import { coupleCost, formatDuration, formatEuro, overlappingIds } from "../lib/activities";
import { ticketUrl } from "../lib/api";
import type { Activity, Day } from "../lib/types";
import { ActivityImage } from "./ui";

export const CANCEL_PLANNING_DROP_ID = "cancel-planning-drop";

export function TodayActivityCard({ activity }: { activity: Activity }) {
  return (
    <article className="today-card">
      <ActivityImage activity={activity} />
      <div className="today-card-body">
        <p className="today-card-time"><Clock3 size={14} /> {activity.time}</p>
        <h3>{activity.title}</h3>
        <p className="today-card-meta">
          <span>{activity.category}</span>
          <span><Clock3 size={13} /> {formatDuration(activity.duration)}</span>
        </p>
        <p className="today-card-place"><MapPin size={13} /> {activity.area}</p>
      </div>
    </article>
  );
}

export function ActivityCard({ activity, onOpen, canDrag = true, overlap = false, orphan = false, onMoveRelative, onDelete, onSchedule, canMoveUp = true, canMoveDown = true }: {
  activity: Activity;
  onOpen?: (activity: Activity) => void;
  canDrag?: boolean;
  overlap?: boolean;
  orphan?: boolean;
  onMoveRelative?: (activity: Activity, direction: -1 | 1) => void;
  onDelete?: (activity: Activity) => void;
  onSchedule?: (activity: Activity) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: activity.id, disabled: !canDrag });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const open = onOpen ? () => onOpen(activity) : undefined;
  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`activity-card ${isDragging ? "is-dragging" : ""} ${overlap ? "has-overlap" : ""} ${open ? "" : "is-readonly"}`}
      onClick={open}
      onKeyDown={open ? (event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); open(); } } : undefined}
      tabIndex={open ? 0 : undefined}
      role={open ? "button" : undefined}
      aria-label={open ? `Modifica ${activity.title}, ore ${activity.time}` : undefined}
    >
      <ActivityImage activity={activity} />
      <div className="activity-body">
        <div className="activity-topline">
          <span className="activity-time">{activity.time}</span>
          {canDrag && <button
            type="button"
            className="drag-handle"
            aria-label={`Trascina ${activity.title}`}
            onClick={(event) => event.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={18} />
          </button>}
        </div>
        <h3>{activity.title}</h3>
        <p className="activity-meta"><span>{activity.category}</span><span><Clock3 size={13} /> {formatDuration(activity.duration)}</span></p>
        {activity.area && <p className="activity-place"><MapPin size={13} /> {activity.area}</p>}
        {overlap && <p className="overlap-note"><Info size={12} /> Si sovrappone a un’altra tappa</p>}
        {orphan && <p className="overlap-note orphan-note"><AlertTriangle size={12} /> Fuori dalle date del viaggio</p>}
        <div className="activity-badges">
          <span className={`status status-${activity.status.toLowerCase().replaceAll(" ", "-")}`}>{activity.status}</span>
          {activity.cost === 0 ? <span className="cost">Gratis</span> : <span className="cost" title={`Coppia: ${formatEuro(coupleCost(activity))}`}>{formatEuro(activity.cost)} a pers.</span>}
          {activity.under26 && <span className="under26">Under 26</span>}
          {activity.ticket && <span className="cost ticket-badge"><FileText size={10} /> Biglietto</span>}
        </div>
        {onSchedule && <button type="button" className="planning-add-button" onClick={(event) => { event.stopPropagation(); onSchedule(activity); }}><CalendarPlus size={15} /> Scegli il giorno</button>}
      </div>
      {(onMoveRelative || onDelete) && (
        <div className="mobile-card-actions" aria-label={`Comandi rapidi per ${activity.title}`}>
          <button type="button" disabled={!canMoveUp} onClick={(event) => { event.stopPropagation(); onMoveRelative?.(activity, -1); }}><ArrowUp /> <span>Sposta su</span></button>
          <button type="button" disabled={!canMoveDown} onClick={(event) => { event.stopPropagation(); onMoveRelative?.(activity, 1); }}><ArrowDown /> <span>Sposta giù</span></button>
          <button type="button" className="quick-delete" aria-label={`Elimina ${activity.title}`} onClick={(event) => { event.stopPropagation(); onDelete?.(activity); }}><Trash2 /></button>
        </div>
      )}
    </article>
  );
}

export function DragPreviewCard({ activity }: { activity: Activity }) {
  return (
    <article className="activity-card drag-preview-card">
      <ActivityImage activity={activity} />
      <div className="activity-body">
        <div className="activity-topline"><span className="activity-time">{activity.time}</span><GripVertical size={18} /></div>
        <h3>{activity.title}</h3>
        <p className="activity-place"><MapPin size={13} /> {activity.area}</p>
      </div>
    </article>
  );
}

export function PlanningCancelDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: CANCEL_PLANNING_DROP_ID });
  return <div ref={setNodeRef} className={`planning-cancel-zone ${isOver ? "is-over" : ""}`} role="status">
    <RotateCcw />
    <div><strong>Annulla spostamento</strong><span>Rilascia qui per lasciare la card in “Da pianificare”</span></div>
  </div>;
}

export function TicketPreview({ ticket }: { ticket: NonNullable<Activity["ticket"]> }) {
  const url = ticketUrl(ticket.key);
  if (ticket.type.startsWith("image/")) return <img className="ticket-preview-image" src={url} alt={`Anteprima ${ticket.name}`} loading="lazy" />;
  if (ticket.type === "application/pdf") return <iframe className="ticket-preview-pdf" src={`${url}#toolbar=0&navpanes=0`} title={`Anteprima ${ticket.name}`} loading="lazy" tabIndex={-1} />;
  return <div className="ticket-preview-file"><FileText /><span>{ticket.type.includes("calendar") ? "Calendario (.ics)" : ticket.type.includes("pkpass") ? "Wallet (.pkpass)" : "Documento"}</span></div>;
}

export function DayColumn({ day, items, onOpen, canDrag = true, locked = false, onToggleLock, quickActions = false, onMoveRelative, onDelete }: {
  day: Day;
  items: Activity[];
  onOpen?: (activity: Activity) => void;
  canDrag?: boolean;
  locked?: boolean;
  onToggleLock?: () => void;
  quickActions?: boolean;
  onMoveRelative?: (activity: Activity, direction: -1 | 1) => void;
  onDelete?: (activity: Activity) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day.id, disabled: locked || !canDrag });
  const totalMinutes = items.reduce((sum, item) => sum + (Number.isFinite(item.duration) ? item.duration : 0), 0);
  const cost = items.reduce((sum, item) => sum + coupleCost(item), 0);
  const intensity = totalMinutes < 420 ? "Leggera" : totalMinutes < 660 ? "Media" : "Intensa";
  const overlapping = overlappingIds(items);
  return (
    <section ref={setNodeRef} className={`day-column ${isOver ? "is-over" : ""} ${locked ? "is-locked" : ""}`} aria-label={day.full}>
      <header className="day-column-header">
        {onToggleLock && <button type="button" className={`column-lock ${locked ? "locked" : ""}`} onClick={onToggleLock} aria-pressed={locked} aria-label={locked ? `Sblocca ${day.full}` : `Blocca ${day.full}`} title={locked ? "Giornata bloccata: tocca per sbloccare" : "Blocca questa giornata"}>{locked ? <Lock /> : <Unlock />}</button>}
        <p>{day.full}</p>
        <div><span>{items.length} tappe</span><span>{formatDuration(totalMinutes)}</span><span title="Stima per la coppia">{formatEuro(cost)}</span><span className={`intensity ${intensity.toLowerCase()}`}>{intensity}</span></div>
      </header>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="day-list">
          {items.map((item, index) => <ActivityCard
            key={item.id}
            activity={item}
            onOpen={onOpen}
            canDrag={canDrag}
            overlap={overlapping.has(item.id)}
            onMoveRelative={quickActions ? onMoveRelative : undefined}
            onDelete={quickActions ? onDelete : undefined}
            canMoveUp={index > 0}
            canMoveDown={index < items.length - 1}
          />)}
          {!items.length && <div className="empty-drop">{canDrag ? "Trascina qui un’attività" : "Nessuna attività"}</div>}
        </div>
      </SortableContext>
    </section>
  );
}
