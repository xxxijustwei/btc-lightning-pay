FROM node:26-bookworm-slim
RUN npm install --global pnpm@12.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY apps/gateway/package.json apps/gateway/package.json
RUN pnpm install --filter @btc-lightning-pay/gateway... --prod --frozen-lockfile
COPY packages/api/src packages/api/src
COPY apps/gateway/src apps/gateway/src
USER node
ENV GATEWAY_HOST=0.0.0.0
EXPOSE 9741
CMD ["node", "apps/gateway/src/server.ts"]
