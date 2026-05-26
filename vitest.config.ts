import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["**/__tests__/**/*.{test,spec}.ts"],
    environment: "node",
    globals: false,
    testTimeout: 15000,
  },
});
