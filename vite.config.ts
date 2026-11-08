import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const serverPort = Number(process.env.RELAY_PORT ?? 8000);
const serverOrigin = `http://localhost:${serverPort}`;

export default defineConfig({
  root: "src/board",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/board", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      // The server only accepts its own Origin, so the dev proxy presents itself as the server.
      "/api": { target: serverOrigin, changeOrigin: true, headers: { origin: serverOrigin } },
    },
  },
});
