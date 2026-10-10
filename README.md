# M&E Viaggi

Archivio condiviso dei viaggi di Matteo ed Elena: viaggi raggruppati per anno, itinerario giornaliero con card trascinabili, idee "Da pianificare", biglietti e documenti, riepilogo con costi derivati dalle attività, personalizzazione (nome, colori, logo, foto) e installazione come app.

È la ricostruzione **indipendente da ChatGPT Sites** della versione 39 (commit `cc59ff8`) dell'app originale. Interfaccia, modelli dati e contratti API sono gli stessi; cambia solo dove gira e come si accede.

---

## 1. Diagnosi: cosa dipendeva da ChatGPT Sites e cosa l'ha sostituito

| Nell'originale | Problema fuori da Sites | Nella nuova versione |
|---|---|---|
| Vinext 0.0.50 (Next App Router su Vite) + build Sites (`build/sites-vite-plugin.ts`, `validate-artifact.sh`) | Toolchain sperimentale legata al builder Sites; la pagina era comunque tutta `"use client"` | App React 19 + TypeScript con **Vite** (stesse librerie: @dnd-kit, lucide-react, Tailwind/PostCSS) |
| `.openai/hosting.json` con `project_id` e binding D1/R2 iniettati dalla piattaforma | Il project ID è dell'installazione originale (non va riusato) | `wrangler.jsonc` con **un tuo** database D1 e bucket R2, oppure SQLite + cartella locale |
| `db/runtime.ts` + `worker/index.ts` di Vinext | Binding passati in una variabile globale dal Worker Sites | `server/worker.ts` (Cloudflare) e `server/node/main.ts` (Node) chiamano lo **stesso** router `server/app.ts` |
| `app/chatgpt-auth.ts`, header `oai-authenticated-user-*` | Fuori da Sites quegli header non esistono (e chiunque potrebbe falsificarli) | **Password condivisa** (`APP_PASSWORD`) → cookie di sessione HttpOnly firmato (HMAC). Tutte le API e i documenti richiedono il login |
| Meta `codex-preview`, `scripts/install-ci.sh` / `sites-env.sh` (flock, GNU timeout, curl) | Specifici del sandbox Codex/Linux | Rimossi: bastano `npm install` e Node ≥ 22.13 su Windows, macOS o Linux |
| Drizzle ORM (usato solo da un esempio) | Codice morto | Rimosso; schema in `migrations/0001_init.sql` (identico alle 3 migrazioni originali consolidate) |
| Seed automatico di `INITIAL_ACTIVITIES` al primo caricamento | Un'installazione nuova avrebbe mostrato dati demo come se fossero reali | L'esempio Parigi si crea **solo** con il pulsante esplicito "Carica l'esempio Parigi 2026" |

## 2. Architettura

```
src/                 frontend React (Vite)
  App.tsx            navigazione, guardie di modifica, drag & drop, import/export
  components/        Archivio, Itinerario, Da pianificare, Riepilogo, Editor, Dialoghi
  lib/useItinerarySync.ts   sincronizzazione con versioni, conflitti e retry
  lib/activities.ts  date, giorni, costi, validazione import
  lib/data.ts        dati e immagini dell'esempio Parigi
shared/site-settings.ts     impostazioni e palette predefinita (usato da client e server)
server/app.ts        router di tutte le /api/*
server/routes/       trips, itinerary, site-settings, assets (+manifest), tickets
server/auth.ts       login con password condivisa
server/worker.ts     entry Cloudflare Workers (D1 + R2 + asset statici)
server/node/         entry Node: SQLite integrato (node:sqlite) + cartella file
migrations/          schema SQL (D1 e SQLite)
tests/               test unitari/API + tests/e2e/smoke.ts (browser reale)
```

API (contratto invariato rispetto all'originale, più login e importazione):

| Endpoint | Cosa fa |
|---|---|
| `GET/POST/PUT/DELETE /api/trips` | elenco, creazione, modifica, eliminazione (solo quel viaggio + i suoi biglietti) |
| `POST /api/trips/import` | **nuovo**: crea un viaggio da `{ trip, activities }` mantenendo l'ID; rifiuta (409) se l'ID esiste già |
| `GET /api/itinerary?tripId=…` | attività, versione, data di aggiornamento |
| `PUT /api/itinerary` | `{ tripId, activities, version }`; **409** con lo stato attuale se la versione è superata |
| `GET/PUT /api/site-settings`, `POST` multipart | impostazioni e caricamento logo/foto |
| `GET /api/site-assets?kind=…` | logo, icone, avatar, polaroid (con fallback in `public/`) |
| `POST /api/tickets`, `GET /api/tickets?key=…` | upload (PDF, PNG, JPEG, WebP, PKPASS, ICS, max 15 MB) e apertura documenti |
| `GET /api/manifest` | manifest PWA dalle impostazioni |
| `GET /api/session`, `POST /api/login`, `POST /api/logout` | **nuovi**: accesso |

Pubblici senza login: manifest, logo e icone (servono alla pagina di login e all'installazione). Tutto il resto, foto personali e biglietti compresi, richiede la sessione.

## 3. Avvio in locale (2 minuti)

Serve **Node.js 22.13 o successivo** ([nodejs.org](https://nodejs.org)).

```bash
npm install
cp .env.example .env        # poi apri .env e scegli APP_PASSWORD
npm run dev                 # http://localhost:5173
```

In sviluppo le API girano dentro Vite con un vero database SQLite in `./.data/` (creato da solo). I dati restano tra un avvio e l'altro. Per cancellarli elimina la cartella `.data/`.

## 4. Pubblicare online (scegline una)

### Opzione A — Cloudflare (consigliata: gratuita per 2 persone, nessun server da gestire)

1. Crea un account su [dash.cloudflare.com](https://dash.cloudflare.com). Per R2 Cloudflare chiede di aggiungere un metodo di pagamento anche nel piano gratuito (10 GB inclusi).
2. Nel terminale, dalla cartella del progetto:
   ```bash
   npx wrangler login
   npx wrangler d1 create me-viaggi          # copia il "database_id" in wrangler.jsonc
   npx wrangler r2 bucket create me-viaggi-files
   npm run cf:migrate                        # crea le tabelle nel D1 remoto
   npx wrangler secret put APP_PASSWORD      # la password condivisa
   npx wrangler secret put AUTH_SECRET       # una stringa lunga e casuale
   npm run cf:deploy
   ```
3. Wrangler stampa l'indirizzo `https://me-viaggi.<tuo-account>.workers.dev`. Puoi collegare un dominio tuo dal pannello Cloudflare.

Prova locale del Worker vero (D1/R2 simulati): crea `.dev.vars` con `APP_PASSWORD=...`, poi `npm run cf:migrate:local && npm run cf:dev` (http://localhost:8787).

### Opzione B — Server Node (VPS, NAS, Raspberry Pi, Render/Railway con disco persistente)

```bash
npm install
npm run build
APP_PASSWORD=... AUTH_SECRET=... DATA_DIR=/percorso/persistente npm start   # porta 8787
```

`DATA_DIR` contiene `me-viaggi.sqlite` e `files/` (logo, foto, biglietti): è **l'unica cosa da salvare nei backup**. Metti il server dietro HTTPS (es. Caddy o il proxy del provider): il cookie diventa `Secure` automaticamente quando la richiesta arriva in HTTPS (`X-Forwarded-Proto` è rispettato).

### Variabili

| Variabile | Obbligatoria | Note |
|---|---|---|
| `APP_PASSWORD` | sì | minimo 6 caratteri; senza, nessuno può entrare |
| `AUTH_SECRET` | consigliata | firma i cookie; se manca è derivata dalla password (cambiarla disconnette tutti) |
| `AUTH_DISABLED` | no | `true` disattiva il login: solo per sviluppo |
| `DATA_DIR`, `PORT` | no | solo server Node |

## 5. Trasferire i dati dal vecchio sito

Vedi **[docs/MIGRAZIONE.md](docs/MIGRAZIONE.md)**. In breve: nel vecchio sito, per ogni viaggio, Riepilogo → Esporta JSON; nella nuova app, Impostazioni → Trasferimento dati → **Importa viaggio (JSON)**. I biglietti e le foto caricate non sono nel JSON e vanno ricaricati.

## 6. Comportamenti importanti

- **Il database è la fonte di verità.** `localStorage` tiene solo una copia per aprire subito l'itinerario, le modifiche non ancora inviate, i blocchi giornalieri e la versione in conflitto.
- **Nessuna normalizzazione "di default"**: il caricamento non riporta mai un'attività a un giorno, titolo o nota in base al suo ID (il difetto di a01–a09 tornate all'11 non può ripresentarsi; c'è un test).
- **Conflitti**: se l'altro dispositivo ha salvato prima, il server risponde 409, la UI mostra la versione più recente e un banner con "Ripristina la mia" / "Tieni la più recente". La modifica locale resta conservata (anche dopo un refresh) finché non scegli.
- **Offline**: le modifiche fatte senza rete restano sul dispositivo con il badge "Non sincronizzato" e vengono reinviate al ritorno della connessione, al focus o ogni 8 secondi. Se nel frattempo l'altro dispositivo ha cambiato l'itinerario, diventano un conflitto da risolvere, non una sovrascrittura. Non è una modalità offline completa: senza rete non si caricano viaggi nuovi né documenti.
- **Blocco giornate e annullamento**: il blocco è una preferenza di questo dispositivo; lo storico "Annulla" (ultime 10 modifiche) vale per la sessione e per il viaggio aperto, e si azzera se arriva un aggiornamento da un altro dispositivo. Entrambi passano dallo stesso controllo di tutte le altre scritture: in sola visualizzazione o su una giornata bloccata nessun comando (drag, editor, frecce, import, ripristino, biglietti, annulla) modifica i dati.
- **Costi**: a persona = somma di `cost`; coppia = `totalCost` se impostato (anche 0) altrimenti `cost × 2`. Contano solo le attività su giorni reali del viaggio (non "Da pianificare" né quelle rimaste fuori date dopo aver accorciato il viaggio).
- **Logo**: mostrato senza riquadro, `object-fit: contain`, nei box 148×84 (archivio), 108×86 (barra laterale), 240×112 (riepilogo; 200×88 su mobile), 84×56 (archivio mobile). Il PNG caricato è salvato byte per byte (trasparenza inclusa); le icone PWA sono derivati separati.

## 7. Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | sviluppo con API e SQLite locali |
| `npm run build` | typecheck + build in `dist/` |
| `npm start` | server Node di produzione |
| `npm test` | test unitari e API (Node, nessun servizio esterno) |
| `npm run test:e2e` | test nel browser (richiede `npm run build` e Chromium; `CHROMIUM_PATH` se non è nel percorso Playwright) |
| `npm run cf:migrate[:local]`, `cf:dev`, `cf:deploy` | Cloudflare |
| `npx tsx scripts/generate-icons.ts` | rigenera le icone PWA di fallback da `public/brand-logo.svg` |

## 8. Limiti noti

- Le foto delle località sono URL esterni (Unsplash, Wikimedia, TheFork): se una fonte non risponde compare un riquadro neutro.
- Il login è una password condivisa, non account separati: non distingue chi ha fatto una modifica. Non c'è limitazione dei tentativi lato server oltre a un ritardo fisso; usa una password non banale.
- Sostituire un biglietto non elimina il file precedente dallo storage (viene eliminato con il viaggio).
- La notifica degli aggiornamenti dagli altri dispositivi avviene per polling (8 s itinerari/viaggi, 10 s impostazioni), come nell'originale.
