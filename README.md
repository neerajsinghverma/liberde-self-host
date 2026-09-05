<div align="center">

# Liberde (self-hosted)

**Run your own Claude.ai-style AI platform — one Node process, one SQLite file, no cloud required.**

The same app that powers [liberde.ai](https://liberde.ai), re-plumbed to run entirely on your own machine: [OpenRouter](https://openrouter.ai) gives every chat access to Claude, GPT, Gemini, Llama, and 400+ models, with artifacts, a design studio, web search, deep research, agentic plan mode, MCP connectors (including local **stdio** servers), custom API tools, skills, memory, and projects.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-local%20file-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

[Quick start](#quick-start) · [Configuration](#configuration) · [How it runs](#how-it-runs) · [Features](#features) · [Security](#security) · [Changelog](CHANGELOG.md)

</div>

---

This is the **self-host build**. Data lives in a local **SQLite** file (`data/liberde.db`) via `better-sqlite3` — there's nothing to provision, no database to connect, and nothing leaves your machine unless you make an outbound model/tool call. Because it runs as a **long-lived process** (not serverless functions), it can do things a serverless deploy can't: connect to **local stdio MCP servers**, run scheduled tasks on an in-process timer, and run long agent/research jobs with no function time limit.

> ### Two editions, same app
> This repo is the **self-host** build (single SQLite file, one Node process). The same app runs hosted at **[liberde.ai](https://liberde.ai)** if you'd rather not run it yourself. Same features; only the storage/runtime differ.
>
> | Edition | Repo | Stack | Use it to… |
> |---|---|---|---|
> | 🖥️ **Self-host** | **liberde-self-host** (this repo) | single SQLite file, one Node process | run it yourself, no DB to provision |
> | ☁️ **Hosted / cloud** | [**liberde**](https://github.com/neerajsinghverma/liberde) | Postgres (Neon) + Vercel | deploy a public multi-user service (powers liberde.ai) |

## Highlights

- 🧠 **Any model, one place** — searchable picker with live pricing; switch mid-conversation, or let **✨ Auto** route each message.
- 🎨 **Artifacts & a Design Studio** — versioned, publishable HTML / React / SVG / Mermaid / Markdown / code / **slide decks**, rendered live in a sandboxed iframe; a separate Design workspace with brand-locked **design systems**.
- 🔍 **Web search & 🔬 Deep Research** — built-in `web_search`/`fetch_page` with citations, plus a parallel research pipeline that streams a cited report.
- ✦ **Agentic Plan mode** — plan-then-execute with the full tool belt.
- 🐍 **Code interpreter in your browser** — the model runs real Python (pandas, numpy, matplotlib, scipy, scikit-learn) on your attached files and hands back charts and spreadsheets, in a sandboxed frame on your own machine. No sandbox service, no per-run cost, nothing to configure.
- 🤖 **Agents** — a named configuration you start a chat as: a model, standing instructions, a project's knowledge, the skills it always loads, and the tools it should reach for. Its model and project are defaults the conversation can override, and unlike a skill its instructions are in force from the first message.
- 🔌 **MCP connectors & 🛠 custom API tools** — add any MCP server (**local stdio command** or remote HTTP, incl. full OAuth 2.1) *or* define your own REST endpoints as callable tools.
- 📚 **Skills, memory & recall**, 👥 **multi-user** with full row-level isolation and an admin panel, plus **second opinion, voice, image gen, office exports, cost tracking, dark mode, PWA** — and more below.
- 🏢 **Workspaces, roles & spend caps** — owner / admin / member / viewer, with a monthly budget for the workspace or per person; over-budget requests are refused *before* a model is called.
- 🔒 **Tamper-evident audit log** — hash-chained record of logins, key creation, tool calls, skill imports and membership changes; verify the chain on demand, export JSONL or CEF for a SIEM.
- ✅ **Verified, not asserted** — `npm run verify` checks that every feature is reachable from the interface, present in both editions, described accurately by these docs, and wired end to end, then runs the logic tests. Written after four features shipped that no screen could reach.
- 💸 **Prompt caching** — explicit cache breakpoints for the model families that need them, so later turns in a long thread re-read the stable prefix at a fraction of the price.

> 📜 **What shipped when:** [CHANGELOG.md](CHANGELOG.md), or the browsable version at [liberde.ai/changelog.html](https://liberde.ai/changelog.html).

## How it compares

Liberde isn't the only open-source AI chat app — [LibreChat](https://github.com/danny-avila/LibreChat), [Open WebUI](https://github.com/open-webui/open-webui), and [LobeChat](https://github.com/lobehub/lobe-chat) are all excellent projects. Here's where Liberde is genuinely different.

*Legend: ✅ built-in · ⚠️ partial / via plugin / community · ❌ not available. These projects all move fast — check their docs for the current state.*

| | **Liberde** | LibreChat | Open WebUI | LobeChat |
|---|:---:|:---:|:---:|:---:|
| Model access | **OpenRouter-native**<br>1 key, 400+ models | multi-provider<br>(+OpenRouter) | Ollama + OpenAI-<br>compatible | 40+ providers |
| **✨ Auto** per-message model routing | ✅ | ❌ | ❌ | ❌ |
| Multi-model answer **+ synthesised verdict** | ✅ | ❌ | ⚠️ | ⚠️ |
| Tamper-evident audit log (JSONL / CEF export) | ✅ | ❌ | ❌ | ❌ |
| Cost + token **+ environmental** transparency | ✅ | ⚠️ | ⚠️ | ❌ |
| **Design Studio** (interactive prototypes / decks / sites) | ✅ | ❌ | ❌ | ❌ |
| Built-in API server + CLI + desktop + PWA | ✅ all four | ⚠️ | ⚠️ | ⚠️ |
| Zero-config self-host (single SQLite file) | ✅ | ❌ (MongoDB) | ✅ | ⚠️ |
| Secrets encrypted at rest (key in env) | ✅ | ⚠️ | ⚠️ | ⚠️ |
| No-code custom REST tools (+ OpenAPI import) | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Web search **+ deep research** | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Multi-model side-by-side compare | ✅ | ⚠️ | ✅ | ⚠️ |
| Claude-style artifacts (versioned, live) | ✅ | ✅ | ❌ | ✅ |
| Agents / custom assistants | ✅ | ✅ | ✅ | ✅ |
| MCP connectors (stdio + HTTP + OAuth) | ✅ | ✅ | ✅ | ✅ |
| Memory across conversations | ✅ | ✅ | ✅ | ✅ |
| Code interpreter | ✅ browser | ✅ server, many languages | ✅ browser + terminal | ⚠️ |
| Spend caps / usage limits | ✅ | ✅ token balance | ❌ | ❌ |
| Roles & permissions | ⚠️ workspace-level | ⚠️ | ✅ groups + per-resource | ❌ |
| Agent / plugin marketplace | ❌ | ⚠️ | ⚠️ | ✅ 500+ |
| Real shell / terminal | ❌ | ✅ | ✅ | ❌ |

**Where Liberde stands out:** **✨ Auto** per-message routing (tiers derived from the live price distribution, not from model names), a **synthesised verdict** across several models that names where they genuinely contradict each other, a **tamper-evident hash-chained audit log** exportable as JSONL or CEF, **cost + environmental transparency** per reply, the **Design Studio**, an **OpenRouter-native one-key** setup, **single-file self-hosting**, and shipping as a **whole platform** — web + OpenAI-compatible API + CLI + desktop + PWA — rather than a chat UI alone.

**Where Liberde is behind.** These are real gaps, not modesty:

- **No marketplace.** LobeChat ships 500+ ready-made agents. Liberde's agents and skills are yours to write, and there is nowhere to browse someone else's.
- **Permissions stop at the workspace.** Open WebUI has groups and per-resource permissions; a Liberde workspace carries budgets and roles but does not yet own individual models, projects or connectors.
- **No shell.** LibreChat and Open WebUI can run real commands on a server. Liberde's code interpreter is the browser only — Python and JavaScript, no processes, no network beyond CORS.
- **One language server-side: none.** LibreChat's interpreter runs Python, JavaScript, Go and Rust in a hosted sandbox. Liberde's runs in your browser, which costs nothing and configures nothing, and cannot do what a server can.

**A note on honesty.** Live artifacts, MCP, memory, branching and agents were all differentiators when versions of this table were first written, and every one of them is table stakes now — they are listed because you should expect them, not because they set Liberde apart. **Browser-run Python is not a differentiator either**: Open WebUI ships the same Pyodide approach and LibreChat has a stronger server-side one. It is here because a code interpreter needing no sandbox service, no credentials and no per-run billing is the right design for a self-hostable app. What none of them offers is running the whole thing **on your own database, under your own key, with an audit trail you can verify** — which is why that is first in the list rather than last.

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
- **✨ Auto model routing** — picks the right model per message (fast / balanced / deep). Tiers come from the live *price* distribution rather than model-name patterns, so a vendor rename never quietly drops a flagship out of the deep tier. Most messages are placed from local signals with no extra API call; only genuinely ambiguous ones pay for a classification step. Thread stickiness and a runtime fallback if a routed model isn't available on your account
- **Second opinion + council verdict** — run the same question through 2–4 models side by side (streaming columns, per-model cost/tokens), then swap the reply you prefer into the thread; the original is kept as a switchable branch. When the answers land, a **separate** model writes a verdict: what they all agree on, every place they genuinely contradict each other, and one consolidated answer you can keep in a click
- **Bring your own clouds** (Settings → Providers) — **OpenAI/Anthropic (direct)**, **Azure AI Foundry**, **AWS Bedrock**, **Google Gemini/Vertex**, or any **custom OpenAI-compatible endpoint** (Groq, Ollama, vLLM…); per-user, full feature parity (web search, PDF extraction, reasoning effort, cost estimates)
- **Models & pricing page** (`/models`) — the live OpenRouter catalog as cards: prices, context size, capability filters (🖼 vision / 🔧 tools / 🎨 image / 🆓 free), your live credit balance, one-click "Chat →" / "Set default"
- **Web search, Claude-style** — built-in `web_search` and `fetch_page`; activity trail, source cards, citations
- **Deep Research** (🔬) — plans queries, runs parallel searches, streams a synthesized, citation-numbered report
- **Plan mode** (✦) — plan-then-execute with the full tool belt; live checklist, final deliverable (often an artifact)
- **MCP connectors** — add any MCP server (**local stdio command or remote HTTP**) in Settings → Connectors; tools become callable mid-conversation. Remote servers support bearer tokens **and the full MCP OAuth 2.1 flow** (discovery, dynamic client registration, PKCE)
- **Custom HTTP/REST tools** — define your own API endpoints as callable tools: a manual builder with a Test button, **OpenAPI 3.x import**, or let the model add one mid-chat (`create_http_tool`). Per-user secrets, a write-guard on non-GET methods, and skills can bundle tools
- **Workspaces, roles and spend caps** — owner / admin / member / viewer. An admin can manage members but cannot mint or demote an owner, and the last owner cannot be removed. Set a monthly workspace budget, a per-person allowance, or both; an over-budget request is refused with a message naming the limit it hit, before any model is called
- **Tamper-evident audit log** (**Settings → Audit log**) — every entry is hashed against the one before it, so an edited or deleted row breaks verification and the check reports which one. Records logins and failures, key creation and revocation, tool calls, skill imports, membership and budget changes. Tool arguments are logged by *name* only, never by value, because the log outlives the conversation. Verify the chain on demand; export JSONL or CEF for a SIEM; retention is configurable
- **Prompt caching** — Anthropic and Qwen bill the whole prompt again each turn unless a `cache_control` breakpoint says otherwise; every other family on OpenRouter caches automatically and is left alone. The system prompt is split into a stable head and a volatile tail so the cached prefix stays byte-identical between turns
- **Parallel agent steps** — the planner marks which steps are independent; those run at the same time while dependent steps stay ordered
- **Reload mid-reply** — a reply in flight is mirrored server-side, so reloading picks the answer up in progress instead of showing a spinner until it lands
- **Queued messages** — type while a reply is streaming and it waits rather than vanishing; it sends when the turn finishes
- **Agent Skills (SKILL.md) interop** — skills follow the open [Agent Skills](https://agentskills.io) standard, so one written for Claude Code, claude.ai, VS Code or Codex loads here unchanged, and yours export the same way. Import single files or a whole skills folder
- **Agents** — a named configuration you start a chat as: a model, standing instructions, a project's knowledge, the skills it always loads, and the connectors and custom tools it should reach for. Build one in **Settings → Agents**; start a chat as it from the chips under the greeting on a new chat. Its model and project are *defaults* — anything the conversation says outranks them, because switching mid-thread is a deliberate act an agent should not undo. Unlike a skill (which waits for a matching task) an agent's skills are in force from the first message
- **Saved prompts** (**Settings → Prompts**) — keep reusable prompts and insert one by name: type `/` in the composer and pick it by its slash name
- **Skills** — reusable procedures with progressive disclosure (the model loads full instructions only when the task matches); can reference connector and custom-tool names
- **Voice conversations** (🎧), **editable artifacts** (✏ / select-and-💬), **office exports** (slides → .pptx, docs → .doc)
- **Code interpreter, in the browser** — the model writes code, runs it, and reads the output (`<liberdeRun>`). Two runtimes share the tag: JavaScript for instant arithmetic and logic checks, and **Python** — real CPython in WebAssembly with pandas, numpy, matplotlib, scipy, scikit-learn and openpyxl, loaded on demand from the code's own imports. Conversation attachments are mounted as real files at `/data`, anything written to `/out` comes back as a download (matplotlib figures are captured automatically), and the kernel is kept alive per conversation so variables and dataframes survive between blocks. It runs in a sandboxed frame with an opaque origin on the user's own machine: no server, no per-run cost, nothing to configure, and identical behaviour on a self-hosted install
- **Scheduled tasks** (⏰) — daily or every-N-hours prompts run by the in-process scheduler; each run lands in a new ⏰-prefixed conversation
- **Branching** — editing/regenerating keeps the old tail as a ⑂ variant (branches never leak into each other's context)
- **Extended thinking** (💭), **image generation** (🎨, default `google/gemini-3.1-flash-image`)
- **Memory** — persistent AND model-editable (`memory_save`/`memory_update`/`memory_forget`, id-handled facts); non-tool models use the `<liberdeMemory>` tag; never active in temporary chats
- **Recall** — the model can search your own past conversations as a tool
- **Planner/executor model split** — route planning/execution to cheaper models while the final deliverable keeps your main model
- **Projects** — group chats under shared instructions + knowledge files
- **Semantic project retrieval** — project knowledge is embedded and searched by meaning, so a paragraph that answers the question in different words is still found. Point it at any OpenAI-compatible `/embeddings` endpoint (OpenAI, a local Ollama, LM Studio) in **Settings → General → Semantic search**; files are indexed as you upload them, and one button indexes the projects you already had. Relevance is judged **relative to the best match** rather than against a fixed score, because embedding models don't share a scale and any absolute cut-off is tuned for exactly one of them. With no endpoint configured it falls back to the lexical scorer — a knowledge base that gets less clever is fine, one that silently stops working because a key expired is not
- **Design studio** — a separate Chat/Design workspace: asks one round of clarifying questions, builds on a live canvas, element-select commenting, per-slide edits, live color/spacing sliders, AI-generated imagery
- **Design systems** — save named brand specs and lock designs to one; create by describing the brand **or by attaching screenshots** (a vision model extracts real colors/fonts), "Remix with AI"
- **Artifacts gallery** — every artifact you've built, and everything shared with you, in one browsable grid at `/artifacts`: card previews that pull the headings and prose out of the source (not the first 600 characters of a stylesheet) plus a strip of the artifact's own palette, filters for All / Yours / Shared with you, and full-text search across titles and contents. Opening one of yours jumps to its conversation; opening a shared one clones an editable copy
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
- **The gallery** (`/artifacts`) collects everything you've made and everything shared with you, with previews, filters, and search across contents.

## Platform API

Create a key in **Settings → Keys**, then call the server like any OpenAI-compatible endpoint:

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

## Verifying a change

```bash
npm run verify        # audit + logic tests + typecheck
```

Six checks, because a green build proves less than it looks like it does:

| Command | Asks |
|---|---|
| `npm run audit` | Can a person **reach** every feature? Does the **other edition** have it? Does the **documentation** describe something that exists? Is each capability **wired end to end**? |
| `npm run test:logic` | Is the logic **right** — routing tiers, budget rules, the audit hash chain, retrieval, conformance, artifact parsing, SSRF? |
| `npm run test:browser` | Does Pyodide actually **boot** in a sandboxed iframe, read a CSV, draw a chart, and keep state between blocks? Real headless Chromium. |
| `npm run test:e2e` | Can a **new account** sign up, open every settings tab, create an agent and start a chat as it? Drives the real app; run it against a local self-host build, never production. |
| `npm run test:soak` | Does an **ordinary session** hold its invariants throughout — no machine tag ever visible, no internal error string shown, no collapsed container, no silent stall — across chat, analysis, artifacts, maths, second opinion, design, plan, the gallery, every settings tab and phone width? |

The audit exists because four features once shipped that no screen could reach, two of
them documented as though they had a home. Types and builds were green throughout —
neither asks whether a user can get to the thing.

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
