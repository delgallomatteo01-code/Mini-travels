/**
 * Self-hosted production server: serves the built frontend (dist/) and the API
 * with SQLite + a local file folder. Run `npm run build` first, then `npm start`.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "../app";
import { createNodeEnv, loadDotEnv, sendWebResponse, toWebRequest } from "./bridge";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
loadDotEnv(root);
const dist = resolve(root, "dist");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

if (!existsSync(resolve(dist, "index.html"))) {
  console.error("dist/index.html non trovato: esegui prima `npm run build`.");
  process.exit(1);
}

const env = createNodeEnv(root);
if (env.AUTH_DISABLED === "true") console.warn("⚠️  AUTH_DISABLED=true: chiunque raggiunga il server può leggere e modificare i dati.");
else if (!env.APP_PASSWORD) console.warn("⚠️  APP_PASSWORD non impostata: l’app mostrerà il login ma nessuno potrà entrare.");

function serveStatic(pathname: string) {
  const decoded = decodeURIComponent(pathname);
  const candidate = resolve(dist, `.${decoded}`);
  if (candidate.startsWith(dist + sep) && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const response = await handleApiRequest(toWebRequest(req), createNodeEnv(root));
      await sendWebResponse(res, response, req.method);
      return;
    }
    const file = serveStatic(url.pathname) ?? resolve(dist, "index.html");
    const extension = extname(file);
    res.setHeader("Content-Type", TYPES[extension] ?? "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (url.pathname.startsWith("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else res.setHeader("Cache-Control", "no-cache");
    if (req.method === "HEAD") { res.end(); return; }
    createReadStream(file).pipe(res);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end("Errore interno");
  }
}).listen(port, host, () => {
  console.log(`M&E Viaggi in ascolto su http://localhost:${port}`);
});
