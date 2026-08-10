import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "llmsafespaces/**", ".local/**"],
    environment: "node",
    server: {
      deps: {
        // Next.js provides `server-only` internally; vitest needs a stub.
        inline: [/^server-only$/],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./test/stubs/server-only.ts"),
    },
  },
});
