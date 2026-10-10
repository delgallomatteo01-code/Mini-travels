import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Edit3, Eye, ListFilter, Plus, Search, Sparkles } from "lucide-react";
import { CATEGORIES } from "../lib/data";
import type { Activity, Day, SyncState } from "../lib/types";
import { isOrphan } from "../lib/activities";
import { ActivityCard } from "./Itinerary";
import { SyncBadge } from "./ui";

export function PlanningView({ activities, days, search, setSearch, filter, setFilter, onOpen, onNew, onSchedule, editMode, onToggleEditMode, syncState }: {
  activities: Activity[];
  days: Day[];
  search: string;
  setSearch: (value: string) => void;
  filter: string;
  setFilter: (value: string) => void;
  onOpen: (activity: Activity) => void;
  onNew: () => void;
  onSchedule: (activity: Activity) => void;
  editMode: boolean;
  onToggleEditMode: () => void;
  syncState: SyncState;
}) {
  const present = CATEGORIES.filter((category) => activities.some((activity) => activity.category === category));
  const filters = ["Tutte", ...present];
  const query = search.trim().toLowerCase();
  const filtered = activities.filter((activity) => {
    const matchesSearch = !query || `${activity.title} ${activity.area} ${activity.address ?? ""} ${activity.category}`.toLowerCase().includes(query);
    return matchesSearch && (filter === "Tutte" || activity.category === filter);
  });

  return (
    <section className="workspace-view planning-view">
      <header className="workspace-header">
        <div><p className="section-kicker">La nostra lista dei desideri</p><h1>Da pianificare</h1></div>
        <div className="header-actions planning-header-actions">
          <SyncBadge state={syncState} />
          <button type="button" className={`mode-button ${editMode ? "active" : "view-only"}`} aria-pressed={editMode} onClick={onToggleEditMode}>{editMode ? <Edit3 size={16} /> : <Eye size={16} />}<span>{editMode ? "Modifica attiva" : "Solo visualizzazione"}</span></button>
          <button type="button" className="new-button" disabled={!editMode} onClick={onNew}><Plus size={17} /> Nuova idea</button>
        </div>
      </header>
      <div className="planning-toolbar">
        <label className="search-box"><Search size={17} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca museo, luogo o quartiere" aria-label="Cerca tra le idee" /></label>
        <div className="filter-row" role="group" aria-label="Filtra per categoria"><ListFilter size={16} />{filters.map((item) => <button type="button" key={item} aria-pressed={filter === item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
      </div>
      <p className="result-count">{filtered.length} {filtered.length === 1 ? "idea disponibile" : "idee disponibili"}{editMode ? " • tocca “Scegli il giorno” per inserirla nell’itinerario" : ""}</p>
      <DndContext>
        <SortableContext items={filtered.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <div className="planning-grid">
            {filtered.map((activity) => <ActivityCard key={activity.id} activity={activity} onOpen={onOpen} onSchedule={editMode ? onSchedule : undefined} canDrag={false} orphan={isOrphan(activity, days)} />)}
          </div>
        </SortableContext>
      </DndContext>
      {!filtered.length && <div className="planning-empty"><Sparkles /><h2>Nessuna idea trovata</h2><p>{activities.length ? "Prova un altro filtro o un’altra ricerca." : "Aggiungi musei, ristoranti o luoghi da inserire più avanti nell’itinerario."}</p></div>}
    </section>
  );
}
