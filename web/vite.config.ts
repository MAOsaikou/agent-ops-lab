import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 47322,
    strictPort: true,
    fs: {
      allow: [path.resolve(import.meta.dirname, "..")],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 47322,
    strictPort: true,
  },
});
