# ---------- Builder ----------
FROM node:20-alpine AS builder

# Install build tools for any native dependencies (optional)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package.json and lockfile first for caching
COPY package*.json ./

# Install all dependencies (including dev) for building
RUN npm ci --verbose

# Copy the full source code
COPY . .

# Build TypeScript
RUN npm run build

# ---------- Runtime ----------
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy only the package.json and lockfile
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --verbose

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/tables ./dist/db/tables

# Expose ports (optional for Discord bot — you might not need 80/443)
EXPOSE 80 443

# Run the bot
CMD ["node", "dist/index.js"]
