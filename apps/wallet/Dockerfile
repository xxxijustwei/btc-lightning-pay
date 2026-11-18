FROM node:26-bookworm-slim AS dependencies
RUN npm install --global pnpm@12.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY apps/wallet/package.json apps/wallet/package.json
RUN pnpm install --filter @btc-lightning-pay/wallet... --prod --frozen-lockfile
FROM oven/bun:1.4.2-debian
WORKDIR /app
COPY --from=dependencies /app /app
COPY packages/api/src packages/api/src
COPY apps/wallet/src apps/wallet/src
USER bun
ENV WALLET_HOST=0.0.0.0
EXPOSE 9741
CMD ["bun", "--no-env-file", "apps/wallet/src/server.ts"]
