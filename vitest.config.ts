import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["actions/**/*.test.ts", "src/**/*.test.ts"],
  },
});
