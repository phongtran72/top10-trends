import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "worker/**", ".next/**", ".claude/**", "research/**"],
    environment: "node",
    // Each database test file starts its own in-memory Postgres; with many files at once that can take over 10 s.
    hookTimeout: 30_000,
    passWithNoTests: true,
  },
});
