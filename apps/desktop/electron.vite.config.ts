import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: { build: { outDir: "dist/main" } },
  preload: {
    build: {
      outDir: "dist/preload",
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.js" } },
    },
  },
  renderer: {
    plugins: [
      react(),
      {
        name: "development-refresh-csp",
        apply: "serve",
        transformIndexHtml: {
          order: "post",
          handler: (html) =>
            html.replace(
              "script-src 'self'",
              "script-src 'self' 'unsafe-inline'",
            ),
        },
      },
      {
        name: "production-network-csp",
        apply: "build",
        transformIndexHtml: (html) =>
          html.replace(
            "connect-src 'self' ws://127.0.0.1:5173",
            "connect-src 'none'",
          ),
      },
    ],
    build: { outDir: "dist/renderer" },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  },
});
