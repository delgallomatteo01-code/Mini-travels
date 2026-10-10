-- M&E Viaggi: schema iniziale per una nuova installazione (D1 o SQLite).
-- Corrisponde allo schema finale dell'app originale (itinerary_state, trips, site_settings).
CREATE TABLE IF NOT EXISTS itinerary_state (
  id TEXT PRIMARY KEY NOT NULL,
  activities_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_position_y INTEGER NOT NULL DEFAULT 50,
  image_scale INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_settings (
  id TEXT PRIMARY KEY NOT NULL,
  settings_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
