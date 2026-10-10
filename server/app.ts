import { handleLogin, handleLogout, handleSession, isAuthenticated, sameOriginWrite } from "./auth";
import { json } from "./http";
import { getManifest, getSiteAsset, PUBLIC_ASSET_KINDS } from "./routes/assets";
import { getItinerary, putItinerary } from "./routes/itinerary";
import { getSettings, putSettings, uploadSiteAsset } from "./routes/site-settings";
import { getTicket, uploadTicket } from "./routes/tickets";
import { createTrip, deleteTrip, importTrip, listTrips, updateTrip } from "./routes/trips";
import type { AppEnv } from "./types";

type Handler = (request: Request, env: AppEnv) => Promise<Response> | Response;

const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  "/api/trips": { GET: listTrips, POST: createTrip, PUT: updateTrip, DELETE: deleteTrip },
  "/api/trips/import": { POST: importTrip },
  "/api/itinerary": { GET: getItinerary, PUT: putItinerary },
  "/api/site-settings": { GET: getSettings, PUT: putSettings, POST: uploadSiteAsset },
  "/api/site-assets": { GET: getSiteAsset },
  "/api/tickets": { GET: getTicket, POST: uploadTicket },
  "/api/manifest": { GET: getManifest },
  "/api/session": { GET: handleSession },
  "/api/login": { POST: handleLogin },
  "/api/logout": { POST: handleLogout },
};

function isPublic(url: URL) {
  if (["/api/manifest", "/api/session", "/api/login", "/api/logout"].includes(url.pathname)) return true;
  return url.pathname === "/api/site-assets" && PUBLIC_ASSET_KINDS.has(url.searchParams.get("kind") ?? "");
}

/** Single entry point for every /api/* request, shared by Cloudflare and Node. */
export async function handleApiRequest(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const route = ROUTES[url.pathname];
  if (!route) return json({ error: "Percorso non trovato" }, 404);
  const method = request.method === "HEAD" ? "GET" : request.method;
  const handler = route[method];
  if (!handler) return json({ error: "Metodo non consentito" }, 405, { Allow: Object.keys(route).join(", ") });

  if (!sameOriginWrite(request)) return json({ error: "Origine non consentita" }, 403);
  if (!isPublic(url) && !(await isAuthenticated(request, env))) {
    return json({ error: "Accesso richiesto" }, 401);
  }
  return handler(request, env);
}
