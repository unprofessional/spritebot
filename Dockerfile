# ---------- Builder ----------
FROM node:22.22.0-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --verbose

COPY . .
RUN npm run build

# ---------- Runtime ----------
FROM node:22.22.0-alpine AS runtime

# Install Infisical CLI
RUN apk add --no-cache curl bash \
    && curl -1sLf "https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.alpine.sh" | bash \
    && apk add --no-cache infisical

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --verbose

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/tables ./dist/db/tables
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 80 443

CMD ["node", "dist/index.js"]
