import { defineConfig } from "@playwright/test";
// Avoid the runner's conflicting inherited terminal-color flags.
delete process.env.NO_COLOR;
const production = process.env.VELA_E2E_PRODUCTION === "1";
const baseURL = production ? "http://127.0.0.1:4173" : "http://127.0.0.1:5173";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 2,
  timeout: 30000,
  reporter: [["list"], ["json", { outputFile: "artifacts/e2e-results.json" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 960 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: production
      ? "npm run preview -- --port 4173"
      : "npm run dev -- --host 0.0.0.0",
    url: baseURL,
    reuseExistingServer: !production && !process.env.CI,
    timeout: 30000,
  },
});
