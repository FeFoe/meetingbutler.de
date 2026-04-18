# Meetingbutler.de

Email-to-calendar SaaS: IMAP → LLM → ICS → SMTP reply. NestJS + TypeScript, PostgreSQL, Redis + BullMQ, Prisma 5.22.

## Local Dev
- PostgreSQL and Redis run via Homebrew (already running)
- `npm run build && npm run db:migrate && node dist/main.js`
- Tests: `node scripts/test-pipeline-mock.js` (27 integration tests)

## Known Quirks
- SMTP: use `admin@meetingbutler.de`; `meetings@` auth fails (password rejected)
- `DEFAULT_FROM_EMAIL` must be set to `admin@meetingbutler.de`
- OpenAI model must be `gpt-5.4-nano` exactly (per spec); API key may be quota-exhausted (429s)
- IMAP polls `admin@meetingbutler.de` every 30s for unseen messages

## Docker
- Build: `docker-compose build --no-cache app` after source changes
- Requires `meetingbutler:local` image + separate `migrate` init container
- Migration runs in separate service (root user) — Prisma schema-engine fails as non-root in Alpine/slim

## Deployment (Hetzner VPS)
- Server: `root@188.245.90.16`, app lives at `/opt/meetingbutler.de`
- Deploy: `./deploy.sh` — pushes to GitHub, SSHes in, pulls, rebuilds image, restarts services
- Production image tag: `meetingbutler:latest` (local dev uses `meetingbutler:local`)
- Caddy handles TLS automatically via Let's Encrypt (config: `Caddyfile`)
- Env vars must exist in `/opt/meetingbutler.de/.env` on server (not committed)

### Required .env vars (production)
```
MAIL_HOST, IMAP_HOST, IMAP_PORT, IMAP_SECURE
SMTP_HOST, SMTP_PORT, SMTP_SECURE
IMAP_ADMIN_USER, IMAP_ADMIN_PASSWORD
SMTP_ADMIN_USER, SMTP_ADMIN_PASSWORD
IMAP_MEETINGS_USER, IMAP_MEETINGS_PASSWORD
SMTP_MEETINGS_USER, SMTP_MEETINGS_PASSWORD
ADMIN_EMAIL, MEETINGS_EMAIL, DEFAULT_FROM_EMAIL, DEFAULT_FROM_NAME
OPENAI_KEY
```

## API Endpoints (local)
- http://localhost:3000/api/admin/health
- http://localhost:3000/api/events
- http://localhost:3000/api/admin/raw-emails
- http://localhost:3000/api/admin/queues
