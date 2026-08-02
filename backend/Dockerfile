# node:22-slim is Debian-based and includes a full SQLite build with the
# R-Tree virtual table extension that GEOGrave's spatial index requires.
# Alpine's SQLite omits R-Tree, so we use slim instead.
FROM node:22-slim

WORKDIR /app

# Install dependencies first (own layer) so Docker cache is only
# invalidated when package files change, not on every source edit.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Create data/uploads dirs, create a least-privilege user (Debian syntax),
# and hand ownership over before dropping to that user.
RUN mkdir -p /app/data /app/uploads \
  && groupadd -r geograve && useradd -r -g geograve geograve \
  && chown -R geograve:geograve /app

USER geograve

EXPOSE 3000

# Health check: the /healthz endpoint executes a real DB query internally,
# so a 200 response confirms both the HTTP server and the database are live.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/healthz', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
