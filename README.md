# Job-Ops

AI-powered job discovery and application pipeline. Automatically finds jobs, scores them against your profile, and generates tailored resumes.

## Workflow
1. **Search**: Scrapes Gradcracker, Indeed, LinkedIn, and UK Visa Sponsorship jobs.
2. **Score**: AI ranks jobs by suitability using OpenRouter.
3. **Tailor**: Generates a custom resume summary for top-tier matches.
4. **Export**: Automates [RxResume](https://rxresu.me) to create tailored PDFs.
5. **Manage**: Review and mark jobs as "Applied" via the dashboard (syncs to Notion).

## Example of generating a tailored resume for a job
https://github.com/user-attachments/assets/5b9157a9-13b0-4ec6-9bd2-a39dbc2b11c5

## Example of applying to a Ready job
https://github.com/user-attachments/assets/07345b4f-71bf-4921-989d-fcf60aeb2518

## Quick Start
```bash
# 1. Setup environment
cp .env.example .env

# 2. Run with Docker
docker compose up -d --build

# 3. Access Dashboard
# http://localhost:3005
```

## Setup
Essential variables in `.env`:
- `OPENROUTER_API_KEY`: For job scoring and tailoring.
- `RXRESUME_EMAIL`/`PASSWORD`: To automate PDF exports.

## Structure
- `/orchestrator`: React frontend + Node.js backend & pipeline.
- `/extractors`: Specialized scrapers (Gradcracker, JobSpy, UKVisaJobs).
- `/resume-generator`: Python script for RxResume PDF automation.
- `/data`: Persistent storage for SQLite DB and generated PDFs.

Technical breakdowns here: `documentation/extractors/README.md`
Orchestrator docs here: `documentation/orchestrator.md`

## Read-only mode (Basic Auth)

Set `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` in `.env` to make the app read-only for the public.
After this, all write actions (POST/PATCH/DELETE) require Basic Auth; browsing and viewing remain public.
2. Put your exported RXResume JSON at `resume-generator/base.json`.
3. Start: `docker compose up -d --build`
4. Open:
   - Dashboard/UI: `http://localhost:3005`
   - API: `http://localhost:3005/api`
   - Health: `http://localhost:3005/health`

Persistent data lives in `./data` (bind-mounted into the container).

## Running (local dev)

Prereqs: Node 20+, Python 3.10+, Playwright browsers (Firefox).

Install Node deps (both packages):

```bash
cd orchestrator && npm install
cd ../extractors/gradcracker && npm install
```

Configure the orchestrator env + DB:

```bash
cd ../orchestrator
cp .env.example .env
npm run db:migrate
npm run dev
```

Set up the resume generator (used for PDF export):

```bash
cd ../resume-generator
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate
pip install playwright
python -m playwright install firefox
```

Dev URLs:
- API: `http://localhost:3001/api`
- UI (Vite): `http://localhost:5173`

## Notes / sharp edges

- **Crawl targets**: edit `extractors/gradcracker/src/main.ts` to change the Gradcracker location/role matrix.
- **Pipeline config knobs**: `POST /api/pipeline/run` accepts `{ topN, minSuitabilityScore }`; `PIPELINE_TOP_N`/`PIPELINE_MIN_SCORE` are used by `npm run pipeline:run` (CLI runner).
- **Anti-bot reality**: crawling is headless + "humanized", but sites can still block; expect occasional flakiness.

## License

AGPLv3
