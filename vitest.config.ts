import { defineConfig } from "vitest/config";

// Scope the root test run to the root suite only. The VS Code extension under
// extensions/ ships its own toolchain and test command, so the root run must not
// sweep its tests (they target the extension's own source and build).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
