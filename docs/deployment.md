# Deployment

This guide covers deploying GEOGrave in a production environment: Docker, environment configuration, reverse proxy setup, TLS, backup scheduling, and a production readiness checklist.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Docker deployment (recommended)](#docker-deployment-recommended)
  - [Build and start](#build-and-start)
  - [Volumes and data persistence](#volumes-and-data-persistence)
  - [Container health check](#container-health-check)
- [Non-Docker deployment](#non-docker-deployment)
- [Environment variables reference](#environment-variables-reference)
- [Reverse proxy](#reverse-proxy)
  - [nginx example](#nginx-example)
- [TLS](#tls)
- [Backup schedule](#backup-schedule)
- [Log management](#log-management)
- [Production checklist](#production-checklist)
- [Scaling considerations](#scaling-considerations)

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 22.5.0 | Uses `node:sqlite` (added in 22.5). Not needed if using Docker. |
| Docker ≥ 24 + Docker Compose v2 | For container deployment |
| 512 MB RAM minimum | SQLite WAL mode + Node.js footprint |
| Persistent volume for `data/` and `uploads/` | Required for data survival across restarts |

---

## Docker deployment (recommended)

### Build and start

```bash
# Clone the repository
git clone https://github.com/Atip-Infa/geograve.git
cd geograve

# Configure environment (edit before starting — see below)
cp backend/.env.example backend/.env
$EDITOR backend/.env

# Start in the background
docker compose up --build -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

The app is available at **http://localhost:3002** by default. To change the host-side port, edit the left side of the `ports` mapping in `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"  # host:container
```

### Volumes and data persistence

`docker-compose.yml` mounts two host directories as volumes:

| Volume | Container path | Host path | Contents |
|---|---|---|---|
| database | `/app/data` | `./backend/data` | `geograve.db` and backups |
| uploads | `/app/uploads` | `./backend/uploads` | Uploaded attachment files |

Both directories are created automatically on first run. Data survives container restarts, rebuilds, and image updates.

To back up the database, copy `backend/data/geograve.db` to a safe location, or use the backup script (see [Backup schedule](#backup-schedule)).

### Container health check

The container has a built-in health check that verifies the HTTP server is reachable and returns a 200 from `/healthz`:

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/healthz', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 10s
```

Check container status with `docker compose ps`. A healthy container shows `healthy`; an unhealthy one will be restarted automatically by Docker if a restart policy is set.

---

## Non-Docker deployment

```bash
cd backend
cp .env.example .env
# Edit .env (see Environment variables below)
npm install --omit=dev
npm start
```

For process management in production, use systemd or PM2:

**systemd example** (`/etc/systemd/system/geograve.service`):

```ini
[Unit]
Description=GEOGrave incident reporting server
After=network.target

[Service]
Type=simple
User=geograve
WorkingDirectory=/opt/geograve/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/geograve/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable geograve
sudo systemctl start geograve
sudo journalctl -u geograve -f  # follow logs
```

---

## Environment variables reference

Full list of supported variables. Set these in `backend/.env` (or pass as Docker environment variables).

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | **Yes** | — | Random secret for signing JWTs. The server refuses to start without this. Generate with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ADMIN_USERNAME` | No | `admin` | Staff account username created on first boot |
| `ADMIN_PASSWORD` | No | *(generated)* | Staff account password. If blank, a random one-time password is generated and printed to the log on first boot only. **Set this before production deployment.** |
| `PORT` | No | `3000` | HTTP port the server binds to |
| `NODE_ENV` | No | `development` | Set to `production` for production deployments. Affects logging format and error detail in responses. |
| `ALLOWED_ORIGINS` | No | *(same-origin)* | Comma-separated list of origins allowed for CORS. Leave empty when the frontend is served by this same Express process (the recommended default). |
| `GEOGRAVE_DATA_DIR` | No | `./data` | Path to the directory containing `geograve.db`. Override in tests to isolate test data. |
| `GEOGRAVE_UPLOAD_DIR` | No | `./uploads` | Path to the directory for uploaded files. Override in tests. |

---

## Reverse proxy

Running behind nginx or a cloud load balancer is recommended in production for:
- TLS termination
- Serving uploaded files efficiently with `sendfile`
- HTTP/2 support
- Additional rate limiting / WAF capabilities

The Express app is configured with `app.set('trust proxy', 1)` — required for correct IP-based rate limiting when behind a single reverse proxy hop.

### nginx example

```nginx
server {
    listen 80;
    server_name yourdomain.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.example.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Serve uploaded files directly from nginx (bypasses Node.js for static files)
    location /uploads/ {
        alias /opt/geograve/backend/uploads/;
        add_header Content-Disposition "inline";
        # Files are UUID-named with whitelisted extensions — no execution risk
        location ~* \.(php|html|js|cgi)$ { deny all; }
    }

    # Proxy everything else to the Node.js app
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # Raise timeout for file uploads
        proxy_read_timeout 120s;
        client_max_body_size 55M;  # 5 files × 10 MB + overhead
    }
}
```

---

## TLS

Always use HTTPS in production. Options:

- **Let's Encrypt / Certbot** — free, automated certificate management. Works with the nginx config above.
- **Cloud load balancer TLS termination** — AWS ALB, GCP HTTPS LB, Cloudflare, etc. The Node.js app stays on HTTP behind the LB.
- **Caddy** — automatic HTTPS with minimal configuration.

Do **not** run the Node.js app directly on port 443 in production. Use a reverse proxy for TLS termination.

---

## Backup schedule

`npm run db:backup` uses SQLite's `VACUUM INTO` to produce a consistent, non-blocking snapshot.

**Recommended cron setup** (hourly backup, 7-day retention):

```cron
# /etc/cron.d/geograve-backup
0 * * * * geograve cd /opt/geograve/backend && node scripts/backup.js >> /var/log/geograve-backup.log 2>&1

# Weekly: delete backups older than 7 days
0 2 * * 0 find /opt/geograve/backend/data/backups -name '*.db' -mtime +7 -delete
```

**Ship backups off-host.** A backup that only lives on the same disk as the live database does not protect against disk or host failure. Copy to S3, a NAS, or another host:

```bash
# Example: sync to S3 after each backup
aws s3 sync /opt/geograve/backend/data/backups/ s3://your-bucket/geograve-backups/
```

**Restoring:** stop the app, replace `backend/data/geograve.db` with the backup file, start the app.

---

## Log management

The application produces two log streams in production:

| Stream | Format | Content |
|---|---|---|
| Access log (morgan) | Apache `combined` | Every HTTP request |
| Slow-request log | JSON (`warn` level) | Requests exceeding 200 ms |
| Application log | Plain text | Startup, migration, errors |

**Capturing logs with Docker:**

```bash
docker compose logs -f --tail=100 geograve
```

To ship logs to a centralised system (CloudWatch, Datadog, Loki), use Docker's logging driver or a log forwarder like Fluent Bit:

```yaml
# docker-compose.yml
services:
  geograve:
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"
```

---

## Production checklist

Before going live, verify every item:

**Security**
- [ ] `JWT_SECRET` set to a strong random value (48+ bytes of hex)
- [ ] `ADMIN_PASSWORD` set to a strong password — not the generated one-time value
- [ ] `NODE_ENV=production` in the environment
- [ ] HTTPS enabled (TLS certificate configured on reverse proxy)
- [ ] `ALLOWED_ORIGINS` left empty (same-origin) or explicitly set to trusted origins only
- [ ] Reverse proxy is the only publicly exposed entry point (Node.js port not exposed directly)

**Data**
- [ ] `backend/data/` and `backend/uploads/` are on a persistent volume
- [ ] Backup script scheduled (cron or systemd timer)
- [ ] Backup outputs are being shipped off-host
- [ ] Restore procedure tested: stop → replace `.db` → start

**Operations**
- [ ] Health check endpoint (`/healthz`) is monitored
- [ ] Process manager (systemd/Docker restart policy) will restart the app on crash
- [ ] Log capture configured and retention policy set
- [ ] Slow-request log monitored for query performance regressions

---

## Scaling considerations

SQLite (WAL mode) provides safe concurrent access for multiple Node.js **processes on one host** sharing the same database file. It does **not** support multiple hosts writing to the same database concurrently.

If you need to scale beyond a single host:

1. **Migrate to PostgreSQL** — see [docs/database.md — PostgreSQL migration path](database.md#postgresql-migration-path).
2. Replace the R-Tree spatial index with PostGIS `GiST` + `ST_DWithin`.
3. Replace `VACUUM INTO` backup with `pg_dump` / continuous WAL archiving.

The application layer (repository interfaces, route handlers, validation) needs no changes — only the database driver and query implementations in `lib/db/` need updating.
