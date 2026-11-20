import { defineConfig } from "vite-plus";

const ignored = [
  // Installed skills retain their upstream formatting and examples.
  "**/.agents/skills/**",
  "**/dist/**",
  "**/.wrangler/**",
  "**/.tanstack/**",
  "**/worker-configuration.d.ts",
  "**/routeTree.gen.ts",
  // drizzle-kit rewrites its migration snapshots on every generate.
  "**/migrations/meta/**",
];

export default defineConfig({
  fmt: { ignorePatterns: ignored },
  lint: { ignorePatterns: ignored },
  test: {
    projects: [
      {
        test: {
          name: "backend",
          include: [
            "apps/backend/src/**/*.test.ts",
            "apps/wallet/src/**/*.test.ts",
            "packages/api/src/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "frontend",
          environment: "happy-dom",
          include: ["apps/frontend/src/**/*.test.{ts,tsx}"],
          setupFiles: ["apps/frontend/src/test/setup.ts"],
        },
      },
      {
        test: {
          name: "pay",
          environment: "happy-dom",
          include: ["apps/pay/src/**/*.test.{ts,tsx}"],
          setupFiles: ["apps/pay/src/test/setup.ts"],
        },
      },
    ],
  },
});
