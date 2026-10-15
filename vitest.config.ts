import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: "test",
      APP_URL: "http://localhost:5173",
      DB_HOST: process.env.TEST_DB_HOST ?? "127.0.0.1",
      DB_USER: process.env.TEST_DB_USER ?? "nexi",
      DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? "nexi_local_pw",
      DB_NAME: process.env.TEST_DB_NAME ?? "nexistore_test",
      MANUAL_PAYMENTS_ENABLED: "true",
      WOMPI_PUBLIC_KEY: "pub_test_dummy",
      WOMPI_INTEGRITY_SECRET: "test_integrity_secret",
      WOMPI_EVENTS_SECRET: "test_events_secret",
    },
  },
});
