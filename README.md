<div align="center">

# 📅 meetingbutler.de

**Forward an email. Get a calendar invite back.**

[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Prisma_5-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.prisma.io)
[![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?style=flat-square&logo=redis&logoColor=white)](https://bullmq.io)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT-412991?style=flat-square&logo=openai&logoColor=white)](https://openai.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com)
[![Caddy](https://img.shields.io/badge/Caddy-TLS-00ADD8?style=flat-square)](https://caddyserver.com)

*Email-to-calendar SaaS — no app, no login, no friction.*

</div>

---

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   User forwards email                                           │
│        │                                                        │
│        ▼                                                        │
│   📬 IMAP Poller ──► 🔄 BullMQ Queue ──► 🤖 LLM (GPT)         │
│                                               │                 │
│                                               ▼                 │
│                                    📋 Event Extraction          │
│                                    (title, time, location,      │
│                                     booking codes, notes…)      │
│                                               │                 │
│                                               ▼                 │
│                                    📁 PostgreSQL (Prisma)       │
│                                               │                 │
│                                    ┌──────────┴──────────┐      │
│                                    ▼                     ▼      │
│                               📎 .ics file         📧 SMTP     │
│                               (calendar invite)    (smart reply │
│                                                     with link)  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The user gets a reply with a `.ics` attachment and a link to view/edit the extracted event details.

---

## Features

- **Zero-friction UX** — works with any email client, no app needed
- **LLM extraction** — pulls title, date/time, location, booking codes, notes, cancellation policy, and more from messy email bodies
- **Smart replies** — natural language updates via email reply (`"move to 3pm"`, `"add note: bring passport"`)
- **ICS generation** — standards-compliant calendar files for all major clients
- **PDF export** — printable event summary with all details
- **Contact card** — `.vcf` download for quick address book import
- **Queue-based** — BullMQ ensures no email gets lost; Bull Board UI for monitoring
- **Admin API** — raw email viewer, queue inspector, health endpoint

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 + TypeScript 5.4 |
| Database | PostgreSQL + Prisma 5.22 |
| Queue | Redis + BullMQ |
| AI | OpenAI GPT (gpt-5.4-nano) |
| Email | ImapFlow + Nodemailer |
| ICS | ical-generator |
| PDF | PDFKit |
| Proxy / TLS | Caddy (auto Let's Encrypt) |
| Container | Docker + Docker Compose |
| Hosting | Hetzner VPS |

---

## Local Dev

**Prerequisites:** Node 20+, PostgreSQL and Redis running locally (e.g. via Homebrew)

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env   # fill in IMAP/SMTP creds + OPENAI_KEY

# Build, migrate, run
npm run build && npm run db:migrate && node dist/main.js
```

**Run integration tests (27 tests, no live email needed):**

```bash
node scripts/test-pipeline-mock.js
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/health` | Health check |
| `GET` | `/api/events` | List all extracted events |
| `GET` | `/api/admin/raw-emails` | Raw email store |
| `GET` | `/api/admin/queues` | Bull Board queue monitor |

---

## Environment Variables

| Variable | Description |
|---|---|
| `IMAP_HOST / IMAP_PORT / IMAP_SECURE` | IMAP connection |
| `SMTP_HOST / SMTP_PORT / SMTP_SECURE` | SMTP connection |
| `IMAP_ADMIN_USER / IMAP_ADMIN_PASSWORD` | IMAP credentials |
| `SMTP_ADMIN_USER / SMTP_ADMIN_PASSWORD` | SMTP credentials |
| `ADMIN_EMAIL` | Polling inbox (e.g. `admin@meetingbutler.de`) |
| `MEETINGS_EMAIL` | Processing inbox |
| `DEFAULT_FROM_EMAIL` | Reply-from address (must be `admin@`) |
| `DEFAULT_FROM_NAME` | Display name for outgoing mails |
| `OPENAI_KEY` | OpenAI API key |

> **Note:** `DEFAULT_FROM_EMAIL` must be set to `admin@meetingbutler.de` — `meetings@` auth fails.

---

## Docker

```bash
# Build image (after source changes)
docker-compose build --no-cache app

# Start all services (app + DB + Redis + Caddy)
docker-compose up -d
```

Migration runs automatically in a separate init container (required due to Prisma schema-engine needing root in Alpine).

---

## Deploy (Hetzner VPS)

```bash
./deploy.sh
```

Pushes to GitHub → SSHes into `root@188.245.90.16` → pulls latest → rebuilds image → restarts services. Caddy handles TLS automatically.

```
/opt/meetingbutler.de/
├── .env          # secrets (not committed)
├── Caddyfile     # TLS + routing config
└── docker-compose.yml
```

---

## Project Structure

```
src/
├── imap/         # IMAP polling (30s interval)
├── email/        # SMTP send service
├── llm/          # OpenAI extraction + update parsing
├── ics/          # Calendar file generation
├── events/       # Event CRUD (Prisma)
├── queue/        # BullMQ job processing
├── pdf/          # PDF summary export
├── admin/        # Health, queue UI, raw email API
└── config/       # Environment config
```

---

<div align="center">

Built by [Felix Förster](https://github.com/FeFoe) · Hosted at [meetingbutler.de](https://meetingbutler.de)

</div>
