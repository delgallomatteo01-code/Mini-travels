import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * In development the real API runs inside the Vite server (SQLite + ./.data),
 * so `npm run dev` gives a working, persistent app with a single command.
 */
function localApi(): Plugin {
  return {
    name: "me-viaggi-local-api",
    apply: "serve",
    async configureServer(server) {
      const { handleApiRequest } = await import("./server/app");
      const { createNodeEnv, loadDotEnv, sendWebResponse, toWebRequest } = await import("./server/node/bridge");
      loadDotEnv(root);
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        try {
          const response = await handleApiRequest(toWebRequest(req), createNodeEnv(root));
          await sendWebResponse(res, response, req.method);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  server: { host: "0.0.0.0", port: 5173 },
  build: { outDir: "dist", emptyOutDir: true },
});
