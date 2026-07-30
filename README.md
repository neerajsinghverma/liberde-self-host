<div align="center">

# Liberde (self-hosted)

**Run your own Claude.ai-style AI platform — one Node process, one SQLite file, no cloud required.**

The same app that powers [liberde.ai](https://liberde.ai), re-plumbed to run entirely on your own machine: [OpenRouter](https://openrouter.ai) gives every chat access to Claude, GPT, Gemini, Llama, and 400+ models, with artifacts, a design studio, web search, deep research, agentic plan mode, MCP connectors (including local **stdio** servers), custom API tools, skills, memory, and projects.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-local%20file-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

[Quick start](#quick-start) · [Configuration](#configuration) · [How it runs](#how-it-runs) · [Features](#features) · [Security](#security)

</div>

---

This is the **self-host build**. Data lives in a local **SQLite** file (`data/liberde.db`) via `better-sqlite3` — there's nothing to provision, no database to connect, and nothing leaves your machine unless you make an outbound model/tool call. Because it runs as a **long-lived process** (not serverless functions), it can do things a serverless deploy can't: connect to **local stdio MCP servers**, run scheduled tasks on an in-process timer, and run long agent/research jobs with no function time limit.

> Prefer not to self-host? [liberde.ai](https://liberde.ai) is the hosted version (Postgres/Vercel) of the same app.

## Highlights

- 🧠 **Any model, one place** — searchable picker with live pricing; switch mid-conversation, or let **✨ Auto** route each message.
- 🎨 **Artifacts & a Design Studio** — versioned, publishable HTML / React / SVG / Mermaid / Markdown / code / **slide decks**, rendered live in a sandboxed iframe; a separate Design workspace with brand-locked **design systems**.
- 🔍 **Web search & 🔬 Deep Research** — built-in `web_search`/`fetch_page` with citations, plus a parallel research pipeline that streams a cited report.
- ✦ **Agentic Plan mode** — plan-then-execute with the full tool belt.
- 🔌 **MCP connectors & 🛠 custom API tools** — add any MCP server (**local stdio command** or remote HTTP, incl. full OAuth 2.1) *or* define your own REST endpoints as callable tools.
- 📚 **Skills, memory & recall**, 👥 **multi-user** with full row-level isolation and an admin panel, plus **second opinion, voice, image gen, office exports, cost tracking, dark mode, PWA** — and more below.

## The platform

| Piece | Where | What it is |
|---|---|---|
| **Web app** | `/` (this repo) | Next.js 15 app: chat, projects, artifacts, design studio, settings |
| **Platform API** | `/v1/*` | OpenAI-compatible REST API secured by Liberde API keys |
| **Desktop app** | `apps/desktop` | Electron shell that auto-starts and wraps the web app |
| **CLI** | `apps/cli` | Zero-dependency terminal chat client (`liberde`) |
| **Mobile** | PWA | Install from the browser ("Add to Home Screen") |

Everything is a client of the one Node server.

## Quick start

```bash
git clone https://github.com/neerajsinghverma/liberde-self-host.git
cd liberde-self-host
npm install
npm run build
npm start                 # → http://localhost:3000
```

That's it — **no database to set up.** The SQLite file and schema are created automatically on first run (in `data/`). On first launch the Settings dialog opens; paste an OpenRouter API key (from [openrouter.ai/keys](https://openrouter.ai/keys)), or set `OPENROUTER_API_KEY` in `.env.local` for a personal single-user install.

For development: `npm run dev`.

## Configuration

All optional — copy `.env.local.example` to `.env.local` and set what you need:

| Variable | Enables |
|---|---|
| `OPENROUTER_API_KEY` | A personal key so you don't paste it in Settings (single-user only; ignored once `REQUIRE_AUTH=1`) |
| `REQUIRE_AUTH=1` | **Multi-user mode** — require login. Set this for any shared/public install |
| `LIBERDE_SECRET_KEY` | Encrypts stored secrets at rest (AES-256-GCM). **Strongly recommended for shared installs** — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and back it up |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Sign in with Google" |
| `RESEND_API_KEY` / `RESEND_EMAIL_DOMAIN` | Password-reset + email-verification emails |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web push (`npx web-push generate-vapid-keys`) |

## Single-user vs multi-user

- **Single-user (default):** no login — it just opens. Ideal for running privately on your own machine. The `OPENROUTER_API_KEY` env fallback is allowed here.
- **Multi-user / shared:** set `REQUIRE_AUTH=1`. The **first account created at `/login` becomes admin** and inherits everything created before it. After that, sign-in is required, signups can be closed from **Admin**, and every user has their **own** OpenRouter key, settings, chats, projects, memory, skills, connectors, custom tools, scheduled tasks, and platform API keys — fully isolated by `user_id`.

## How it runs

Because it's one persistent process backed by SQLite, the self-host build differs from the hosted (serverless) version in a few deliberate ways:

- **Storage** — `lib/db.ts` uses `better-sqlite3`; the schema is created + migrated idempotently at startup. Everything (chats, users, keys, artifacts) lives in `data/liberde.db`.
- **Scheduled tasks** run on an **in-process scheduler** (started via `instrumentation.ts`) as long as the server is up — no external cron needed.
- **MCP connectors** can be **local stdio commands** *or* remote HTTP — the long-lived process can spawn and hold a subprocess, which serverless can't.
- **No function time limit** — long agent/research/design runs aren't bounded by a serverless deadline.
- **Sessions** are DB-backed opaque tokens (auth in `lib/auth.ts`); every user-owned row carries `user_id`.

### Running it as a real service

For anything beyond localhost, put it behind a reverse proxy (nginx/Caddy) for HTTPS and run it under a process manager:

```bash
npm run build
REQUIRE_AUTH=1 LIBERDE_SECRET_KEY=<your-64-hex-key> npm start
# then keep it alive with pm2 / systemd / a Docker container, and
# proxy https://your-domain → http://localhost:3000
```

Set `REQUIRE_AUTH=1` (so login is enforced) and `LIBERDE_SECRET_KEY` (so stored keys are encrypted at rest) for any shared deployment.

### Data & backups

Everything is in the single SQLite file. **Backup = copy `data/liberde.db`** (ideally while the app is stopped, or use `sqlite3 .backup`). Nothing is stored anywhere else.

## Features

<details>
<summary><b>Full feature list</b> (click to expand)</summary>

- **Streaming chat** with stop, regenerate, and edit-and-resend
- **Any OpenRouter model**, searchable picker with pricing and context size; switch models mid-conversation
- **✨ Auto model routing** — pick the right model per message (fast / balanced / deep tiers) with a cheap classifier, thread stickiness, and a runtime fallback if a routed model isn't available on your account
- **Second opinion** — run the same question through 2–4 models side by side (streaming columns, per-model cost/tokens), then swap the reply you prefer into the thread; the original is kept as a switchable branch
- **Bring your own clouds** (Settings → Providers) — **OpenAI/Anthropic (direct)**, **Azure AI Foundry**, **AWS Bedrock**, **Google Gemini/Vertex**, or any **custom OpenAI-compatible endpoint** (Groq, Ollama, vLLM…); per-user, full feature parity (web search, PDF extraction, reasoning effort, cost estimates)
- **Models & pricing page** (`/models`) — the live OpenRouter catalog as cards: prices, context size, capability filters (🖼 vision / 🔧 tools / 🎨 image / 🆓 free), your live credit balance, one-click "Chat →" / "Set default"
- **Web search, Claude-style** — built-in `web_search` and `fetch_page`; activity trail, source cards, citations
- **Deep Research** (🔬) — plans queries, runs parallel searches, streams a synthesized, citation-numbered report
- **Plan mode** (✦) — plan-then-execute with the full tool belt; live checklist, final deliverable (often an artifact)
- **MCP connectors** — add any MCP server (**local stdio command or remote HTTP**) in Settings → Connectors; tools become callable mid-conversation. Remote servers support bearer tokens **and the full MCP OAuth 2.1 flow** (discovery, dynamic client registration, PKCE)
- **Custom HTTP/REST tools** — define your own API endpoints as callable tools: a manual builder with a Test button, **OpenAPI 3.x import**, or let the model add one mid-chat (`create_http_tool`). Per-user secrets, a write-guard on non-GET methods, and skills can bundle tools
- **Skills** — reusable procedures with progressive disclosure (the model loads full instructions only when the task matches); can reference connector and custom-tool names
- **Voice conversations** (🎧), **editable artifacts** (✏ / select-and-💬), **office exports** (slides → .pptx, docs → .doc)
- **Analysis tool** — the model runs JavaScript in a browser sandbox (`<liberdeRun>`) and iterates on the output
- **Scheduled tasks** (⏰) — daily or every-N-hours prompts run by the in-process scheduler; each run lands in a new ⏰-prefixed conversation
- **Branching** — editing/regenerating keeps the old tail as a ⑂ variant (branches never leak into each other's context)
- **Extended thinking** (💭), **image generation** (🎨, default `google/gemini-3.1-flash-image`)
- **Memory** — persistent AND model-editable (`memory_save`/`memory_update`/`memory_forget`, id-handled facts); non-tool models use the `<liberdeMemory>` tag; never active in temporary chats
- **Recall** — the model can search your own past conversations as a tool
- **Planner/executor model split** — route planning/execution to cheaper models while the final deliverable keeps your main model
- **Projects** — group chats under shared instructions + knowledge files
- **Design studio** — a separate Chat/Design workspace: asks one round of clarifying questions, builds on a live canvas, element-select commenting, per-slide edits, live color/spacing sliders, AI-generated imagery
- **Design systems** — save named brand specs and lock designs to one; create by describing the brand **or by attaching screenshots** (a vision model extracts real colors/fonts), "Remix with AI"
- **User-to-user sharing** — share design systems *and* artifacts to another user by email; artifacts land in their "Shared with you" view where "Open & edit a copy" clones into their own Design conversation
- **Attachments** — paste/drag images (auto-downscaled like Claude), **PDFs** (server-side text extraction), text/code files
- **Personalization** ("about you" + "response style"), **web push** (Plan/task-done notifications), **share chats** (immutable `/share/<id>`), **temporary chats** (no memory, auto-purged 24h)
- **Unified full-text search** across chats, messages, projects, knowledge files, and artifact contents
- **Cost tracking** — real OpenRouter cost + tokens per reply, attributed by category
- **Organization** — star (pinned), archive, collapsible date-grouped history; **markdown** with GFM tables + syntax highlighting; **dark/light** theme; **PWA** installable on phones

</details>

## Artifacts

Liberde implements the same artifact architecture as Claude.ai:

- Every chat's system prompt teaches the model an inline tag protocol (`<liberdeArtifact identifier=... command=create|update|rewrite>`), so artifacts work with **any** OpenRouter model — no tool-calling required.
- `update` commands are exact str-replace patches (`<liberdeOld>`/`<liberdeNew>`) applied server-side — small edits don't regenerate the whole artifact. Every command creates a new **version**.
- Types: `html`, `react`, `svg`, `mermaid`, `markdown`, `code`, and **`slides`** (full presentations with arrow-key navigation, ⛶ Present mode, print-CSS PDF export). HTML/React/SVG/Mermaid render live in a **sandboxed iframe** (React compiled in-browser via Babel, deps from esm.sh; Tailwind CDN).
- **Publish** any artifact for a stable public link at `/a/<id>` (always-latest or version-pinned), or a full-screen hosted page at `/live/<id>`. Viewers can **Remix** into their own conversation.

## Platform API

Create a key in **Settings → Platform API keys**, then call the server like any OpenAI-compatible endpoint:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer lbd-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-4","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

`GET /v1/models` lists models. Point any OpenAI SDK at `baseURL: "http://localhost:3000/v1"`.

## CLI

```bash
cd apps/cli
npm link                              # installs the `liberde` command
liberde config --server http://localhost:3000 --key lbd-...
liberde                               # interactive chat
liberde -p "explain CORS"             # one-shot
liberde models claude                 # filter model list
```

## Desktop app

```bash
cd apps/desktop
npm install
npm start                             # launches the shell; starts the server if needed
npm run dist                          # build a Windows installer (electron-builder)
```

Set `LIBERDE_URL` to point the shell at a remote Liberde server.

## Architecture

- `lib/db.ts` — **SQLite** schema + data access (`better-sqlite3`), created/migrated at startup
- `lib/openrouter.ts` — upstream client, model cache, prompt assembly, Auto-routing
- `lib/auth.ts` — sessions, scrypt password hashing, lockout; `lib/ssrf.ts` — outbound-fetch guard; `lib/crypto-secrets.ts` — at-rest encryption
- `lib/scheduler.ts` (+ `instrumentation.ts`) — the in-process task scheduler
- `app/api/chat/route.ts` — the streaming pipeline: persists the user turn, streams SSE deltas, runs the tool loop, persists the assistant turn (also on client abort), then auto-titles new conversations
- `app/v1/*` — the platform API; authenticates `lbd-` keys (SHA-256 hashes) and proxies to OpenRouter
- `components/AppShell.tsx` — a single client shell using `history.pushState` navigation so streams survive route changes

## Security

- **Passwords** are salted **scrypt** hashes with timing-safe comparison. **Sessions** are DB-backed opaque tokens (stored hashed, expiring) in `httpOnly` + `SameSite=Lax` + `Secure` (prod) cookies; a password reset invalidates every session.
- **Secrets encrypted at rest** — with `LIBERDE_SECRET_KEY` set, OpenRouter/provider API keys, custom-tool secrets, and MCP tokens are encrypted with **AES-256-GCM**; the key lives only in the environment, so the SQLite file alone reveals nothing. (Unset = plaintext, acceptable only for a trusted single-user local install.) Platform API keys are shown once and stored as hashes; secrets are redacted before reaching the client.
- **Multi-user isolation** — every user-owned row is scoped by `user_id`, enforced on every API route.
- **Brute-force protection** — durable per-account lockout (10 failed logins → a temporary lock an admin can clear) plus IP rate-limiting on login, password-reset, and verification-email endpoints.
- **SSRF-guarded outbound fetches** — web fetch, custom HTTP tools, MCP connects, and OpenAPI imports validate the target host on **every redirect hop** and block loopback / private / link-local / cloud-metadata ranges; secret headers are dropped on cross-host redirects.
- **Sandboxed artifacts** — user/model-authored HTML runs in an iframe with **no `allow-same-origin`** (opaque origin), both in-app and on hosted `/live` pages, so artifact scripts can never touch your session or call authenticated APIs.
- **CSRF & clickjacking** — state-changing API requests are Origin-checked; global `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` (except embeddable published pages), plus `nosniff` and a strict `Referrer-Policy`.
- **Public vs private sharing** — `/share/<id>`, `/a/<id>`, `/live/<id>` are intentionally public; user-to-user shares resolve strictly by account and are read-only for recipients.

Found something? Please open a **private security advisory** on GitHub rather than a public issue.

## Contributing

Contributions welcome! TypeScript + Next.js 15 (App Router), SQLite via `better-sqlite3`.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build / type-check
```

- Keep changes focused and match the surrounding style.
- Data access goes through `lib/db.ts`; keep every user-owned query scoped by `user_id`.
- Open an issue for anything large before starting so we can align on the approach.

## License

[MIT](LICENSE) © neerajsinghverma
