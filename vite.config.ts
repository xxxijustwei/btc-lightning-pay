import { defineConfig } from "vite-plus";

const ignored = [
  // Installed skills retain their upstream formatting and examples.
  "**/.agents/skills/**",
  "**/dist/**",
  "**/.wrangler/**",
  "**/.tanstack/**",
  "**/worker-configuration.d.ts",
  "**/routeTree.gen.ts",
];

export default defineConfig({
  fmt: { ignorePatterns: ignored },
  lint: { ignorePatterns: ignored },
  test: {
    projects: [
      {
        test: {
          name: "backend",
          include: ["apps/backend/src/**/*.test.ts", "apps/gateway/src/**/*.test.ts"],
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
    ],
  },
});
