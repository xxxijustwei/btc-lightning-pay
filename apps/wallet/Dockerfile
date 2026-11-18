FROM node:26-bookworm-slim
RUN npm install --global pnpm@12.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY apps/wallet/package.json apps/wallet/package.json
RUN pnpm install --filter @btc-lightning-pay/wallet... --prod --frozen-lockfile
COPY packages/api/src packages/api/src
COPY apps/wallet/src apps/wallet/src
USER node
ENV WALLET_HOST=0.0.0.0
EXPOSE 9741
CMD ["node", "apps/wallet/src/server.ts"]
