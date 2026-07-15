# ---------- Builder ----------
FROM node:22.22.0-bookworm-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --verbose

COPY . .
RUN npm run build

# ---------- Runtime ----------
FROM node:22.22.0-bookworm-slim AS runtime

# Install Infisical CLI
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl \
    && curl -1sLf "https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh" | bash \
    && apt-get install -y --no-install-recommends infisical \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --verbose

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/tables ./dist/db/tables
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 80 443

CMD ["node", "dist/index.js"]
