import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.js/,
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:8123",
    locale: "pl-PL",
    timezoneId: "Europe/Warsaw",
    ...(process.env.PW_CHROME_PATH ? { launchOptions: { executablePath: process.env.PW_CHROME_PATH } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "telefon", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "node tests/e2e/static-server.js 8123", port: 8123, reuseExistingServer: !process.env.CI },
    { command: "node tests/e2e/fake-firebase.js 9199", port: 9199, reuseExistingServer: !process.env.CI },
  ],
});
