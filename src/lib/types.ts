export type View = "trips" | "home" | "itinerary" | "planning" | "trip";

export type Category =
  | "Volo"
  | "Navetta"
  | "Hotel"
  | "Museo"
  | "Attrazione"
  | "Passeggiata"
  | "Ristorante"
  | "Pausa"
  | "Trasporto"
  | "Anniversario"
  | "Shopping";

export type Status =
  | "Prenotato"
  | "Da prenotare"
  | "Pagato"
  | "Gratuito"
  | "Facoltativo"
  | "Confermato";

export type SyncState = "loading" | "saving" | "synced" | "offline";

export type Ticket = { name: string; key: string; type: string };

export type Activity = {
  id: string;
  dayId: string;
  time: string;
  title: string;
  category: Category;
  duration: number;
  area: string;
  address?: string;
  cost: number;
  totalCost?: number;
  status: Status;
  description?: string;
  bookingLink?: string;
  mapsLink?: string;
  note?: string;
  rainAlternative?: string;
  image?: string;
  imagePositionY?: number;
  imageScale?: number;
  ticket?: Ticket;
  under26?: boolean;
};

export type Day = {
  id: string;
  date: string;
  tab: string;
  full: string;
  theme: string;
};

export type Trip = {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  image: string;
  imagePositionY: number;
  imageScale: number;
  createdAt?: number;
  updatedAt?: number;
};

export type TripInput = Omit<Trip, "id" | "createdAt" | "updatedAt">;

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const PLANNING_DAY_ID = "planning";
