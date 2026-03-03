import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: ".",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    open: true,
    headers: {
      // Required for SharedArrayBuffer (WASM threads) if needed later
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  base: process.env.GITHUB_PAGES ? "/strepitus/" : "/",
  build: {
    target: "es2022",
    outDir: "dist",
  },
  optimizeDeps: {
    exclude: ["strepitus-core"],
  },
});
