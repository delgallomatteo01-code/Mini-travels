/**
 * Cloudflare Worker entry. Static files from dist/ are served by the Workers
 * assets binding (with SPA fallback); only /api/* reaches this code.
 */
import { handleApiRequest } from "./app";
import type { AppEnv, ObjectStore, SqlDatabase } from "./types";

interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: SqlDatabase;
  BUCKET: ObjectStore;
  APP_PASSWORD?: string;
  AUTH_SECRET?: string;
  AUTH_DISABLED?: string;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const appEnv: AppEnv = {
        DB: env.DB,
        BUCKET: env.BUCKET,
        APP_PASSWORD: env.APP_PASSWORD,
        AUTH_SECRET: env.AUTH_SECRET,
        AUTH_DISABLED: env.AUTH_DISABLED,
      };
      return handleApiRequest(request, appEnv);
    }
    return env.ASSETS.fetch(request);
  },
};
