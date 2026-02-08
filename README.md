# ClawdAgent v5.0.0

**Autonomous AI Agent** — talks via Telegram/Discord/WhatsApp/Web, manages servers, writes code, controls phones, creates content, and has persistent memory.

## Features

- **12 Specialized Agents** — Server Manager, Code Assistant, Researcher, Task Planner, General, Security Guard, Desktop Controller, Project Builder, Web Agent, Content Creator, Orchestrator, Device Controller
- **18 Tools** — bash, file, search, github, task, db, browser, kie, social, openclaw, cron, memory, auto, email, workflow, analytics, claude-code, device
- **Multi-Model AI** — Claude Code CLI (FREE) + Anthropic API + OpenRouter (400+ models)
- **Claude Code Provider** — Uses Claude Max subscription ($200/month flat, unlimited) as primary provider
- **Smart Model Router** — Priority: Claude Code (free) → Anthropic API → OpenRouter
- **Intent Classification** — AI-based router with keyword fallback, 45+ intents (Hebrew + English)
- **Persistent Memory** — PostgreSQL + Redis, learns from conversations
- **Telegram/Discord/WhatsApp/Web** — Multi-platform interfaces
- **SSH Server Management** — Remote server control, Docker ops, auto-fix
- **GitHub Integration** — PRs, issues, code review, webhooks
- **Content Creation** — AI images, videos, music via Kie.ai (60+ models) + social publishing via Blotato
- **Mobile Device Control** — Android automation via ADB + Appium + pre-built app recipes (WhatsApp, TikTok, Instagram)
- **OpenClaw Bridge** — Bidirectional sync with OpenClaw gateway
- **Plugin System** — Extensible via manifest-based plugins
- **YAML Config** — Hot-reloadable configuration
- **MCP Support** — Model Context Protocol for external tool servers
- **Behavior Engine** — 10 behaviors with auto language detection
- **Self-Repair** — 9 known fix patterns + AI-powered diagnosis
- **Auto-Upgrade** — Checks GitHub for updates
- **Security** — RBAC, encryption, rate limiting, bash sandboxing, command guard

## Quick Start

```bash
# 1. Clone
git clone https://github.com/liorbs/clawdagent.git
cd clawdagent

# 2. Install
pnpm install

# 3. Configure
cp .env.example .env
# Edit .env with your API keys

# 4. Database
docker compose up -d postgres redis

# 5. Start
pnpm dev
```

## Requirements

- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- pnpm 9+
- Claude Code CLI (optional but recommended — `npm install -g @anthropic-ai/claude-code && claude login`)

## Architecture

```
src/
  index.ts              — Entry point
  config.ts             — Zod-validated environment config
  core/                 — Engine, router, AI client, model router, orchestrator
  agents/               — 12 agents + 18 tools + per-agent prompts
  memory/               — Database schema, repositories, cache
  queue/                — BullMQ worker, scheduler, jobs
  actions/              — GitHub, server manager, web search, tasks, mobile, browser, content
  interfaces/           — Telegram, Discord, WhatsApp, Web API + dashboard
  security/             — Auth, RBAC, encryption, rate limiting, sandbox
  services/             — SSH tunnel, OpenClaw sync
  utils/                — Logger, errors, retry, validators, helpers

config/
  clawdagent.yaml       — Main YAML config
  agents/               — Per-agent YAML configs
  models/router.yaml    — Model routing rules
  behaviors/            — Behavior markdown files
  mcp/servers.yaml      — MCP server configs

plugins/                — Plugin directory
web/                    — React dashboard (Vite + Tailwind)
```

## Agents

| Agent | Description | Tools |
|-------|-------------|-------|
| Server Manager | SSH, Docker, monitoring, auto-fix | bash, ssh, docker, openclaw, memory |
| Code Assistant | Write, fix, review code. GitHub PRs | github, file, bash, memory |
| Researcher | Web search, summarize, answer questions | search, scrape, browser, memory |
| Task Planner | Tasks, reminders, cron, workflows | task, reminder, cron, memory, workflow |
| General | Chat, help, email, analytics | bash, search, file, cron, memory, email, analytics |
| Security Guard | Review commands for safety | — |
| Desktop Controller | Mouse, keyboard, screenshots, vision | desktop, memory |
| Project Builder | Scaffold, build, deploy apps | bash, file, docker, memory |
| Web Agent | Sign up, fill forms, scrape, browse | browser, bash, search, file, memory |
| Content Creator | AI images/video/music + social publish | kie, social, bash, search, file, memory, workflow |
| Orchestrator | ClawdAgent + OpenClaw coordination | openclaw, kie, social, bash, search, db, cron, memory |
| Device Controller | Android phone automation via ADB/Appium | device, memory |

## Docker

```bash
# Full stack (app + postgres + redis)
docker compose up -d

# Dev mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `OPENROUTER_API_KEY` | OpenRouter key (400+ models) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `GITHUB_TOKEN` | GitHub PAT for PRs/issues |
| `KIE_API_KEY` | Kie.ai key for content creation |
| `BLOTATO_API_KEY` | Blotato key for social publishing |

## License

MIT License — see [LICENSE](LICENSE)
