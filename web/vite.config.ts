import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const API = `http://127.0.0.1:${process.env.MEA_PORT ?? 7766}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API, changeOrigin: false },
      "/share-target": { target: API, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: true,
    reportCompressedSize: false,
  },
});
