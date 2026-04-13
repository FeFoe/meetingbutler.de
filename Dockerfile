FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY tsconfig.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client
RUN npx prisma generate

# Build
RUN npx nest build

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y dumb-init openssl wget && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built output and Prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Create data directories
RUN mkdir -p /app/data/uploads

# Non-root user
RUN groupadd -g 1001 meetingbutler && \
    useradd -u 1001 -g meetingbutler -s /bin/sh meetingbutler && \
    chown -R meetingbutler:meetingbutler /app

USER meetingbutler

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/admin/health || exit 1

ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/main"]
