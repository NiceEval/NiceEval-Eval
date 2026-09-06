import { defineConfig } from "niceeval";

export default defineConfig({
  // The official verifier alone has a 180s budget. The inner Attempt also
  // prepares Docker, runs the reference agent and installs test dependencies.
  timeoutMs: 6 * 60_000,
});
