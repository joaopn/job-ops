# JobOps (fork)

Self-hosted job search automation. Searches LinkedIn, Indeed, Glassdoor and 10+ job boards from one screen, rewrites your CV for each role, scores fit, checks visa sponsorship, and tracks applications — all running locally in Docker.

Does not auto-apply.

## Quick Start

```bash
docker compose up -d
```

Open `http://localhost:3005` and follow the onboarding wizard.

The image is built locally from the included [`Dockerfile`](Dockerfile); nothing is pulled from an upstream registry.

## How It Works

| Step | What happens |
|------|-------------|
| **Search** | Scrapes 10+ job boards for roles matching your criteria |
| **Score** | AI ranks each job 0-100 against your profile |
| **Tailor** | Generates a rewritten CV matched to each job description |
| **Export** | Creates a polished PDF locally, or via [Reactive Resume](https://rxresu.me) |
| **Track** | Connects to Gmail and auto-detects interviews, offers, and rejections |

## Supported Job Boards

| Platform | Focus |
|----------|-------|
| LinkedIn | Global |
| Indeed | Global |
| Glassdoor | Global |
| Adzuna | Multi-country API |
| Hiring Cafe | Global |
| startup.jobs | Startup/remote roles |
| Working Nomads | Remote-only |
| Gradcracker | STEM/Grads (UK) |
| UK Visa Jobs | Sponsorship (UK) |
| Golang Jobs | Go developers |
| Seek | Australia/NZ (via Apify) |

Custom extractors can be added in TypeScript — see [`extractors/`](extractors/).

## Post-Application Tracking

Connect Gmail and JobOps watches for recruiter replies automatically.

- *"We'd like to invite you to interview..."* → **Interviewing**
- *"Unfortunately we won't be progressing..."* → **Rejected**

## AI Providers

Works with any of:

- Codex (local app-server in Docker, authenticated with `codex login`)
- OpenAI
- Google Gemini
- OpenRouter
- Any OpenAI-compatible endpoint (Ollama, LM Studio, etc.)

## Documentation

Docs are bundled with the app. When running locally, open `http://localhost:3005/docs`. The source markdown lives in [`docs-site/docs/`](docs-site/docs/).

## License

**AGPLv3 + Commons Clause** — see [LICENSE](LICENSE).
