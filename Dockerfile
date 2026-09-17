# The QUIC binding's Linux prebuild needs glibc 2.38, so Debian trixie rather than bookworm.
FROM node:22-trixie-slim AS base
WORKDIR /app
COPY --from=oven/bun:1.3 /usr/local/bin/bun /usr/local/bin/bun

FROM base AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:22-trixie-slim
# The server mints its own short-lived certificate with openssl.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY package.json ./
COPY shared shared
COPY server server
EXPOSE 8080 4433/udp
CMD ["node", "server/main.ts"]
