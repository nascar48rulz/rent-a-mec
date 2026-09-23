FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /data /tmp/rent-a-mec-data

ENV NODE_ENV=production
ENV HTTPS=0
ENV PORT=8080
ENV RAM_DATA_DIR=/tmp/rent-a-mec-data
ENV RAM_DB_PATH=/tmp/rent-a-mec-data/rentamec.db

EXPOSE 8080

# Seed demo data if DB missing, then start (works on free ephemeral disks)
CMD ["sh", "-c", "mkdir -p \"$(dirname \"$RAM_DB_PATH\")\"; if [ ! -f \"$RAM_DB_PATH\" ]; then node scripts/seed.js; fi; exec node server/index.js"]
