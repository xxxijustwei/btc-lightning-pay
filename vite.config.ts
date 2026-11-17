import { defineConfig } from "vite-plus";

const generated = [
  "**/dist/**",
  "**/.wrangler/**",
  "**/.tanstack/**",
  "**/worker-configuration.d.ts",
  "**/routeTree.gen.ts",
];

export default defineConfig({
  fmt: { ignorePatterns: generated },
  lint: { ignorePatterns: generated },
  test: {
    projects: [
      { test: { name: "backend", include: ["apps/backend/src/**/*.test.ts"] } },
      {
        test: {
          name: "frontend",
          environment: "happy-dom",
          include: ["apps/frontend/src/**/*.test.{ts,tsx}"],
          setupFiles: ["apps/frontend/src/test/setup.ts"],
        },
      },
    ],
  },
});
