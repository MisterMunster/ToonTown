import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 },
  build: {
    target: "es2020",
    outDir: "dist",
    assetsInlineLimit: 4096,
    // Babylon.js core is bundled into the entry chunk (~7 MB raw, ~1.1 MB brotli).
    chunkSizeWarningLimit: 9000,
    sourcemap: false,
  },
});
