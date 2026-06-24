# AI Team App Builder

AI Team App Builder is a LangGraph-based local app generator. It takes a plain English requirement, clarifies it, designs a full-stack blueprint, breaks the work into phases and tasks, writes code into a sandbox, reviews and executes each task, then generates Docker deployment files for the finished prototype.

The current supported stack is intentionally constrained:

- Backend: Node.js, Express, ES modules
- Frontend: React, Vite, Tailwind CSS
- Database: PostgreSQL or MongoDB
- Local deployment: Docker Compose

## Architecture Diagram

Paste the architecture diagram here.

```text
[diagram placeholder]
```

## Workflow

1. `pmAgent` clarifies the original requirement until a usable product spec exists.
2. `architectAgent` builds the blueprint in five steps: entities, database schema, API endpoints, frontend pages, and folder/dependency structure.
3. `blueprintValidator` checks consistency across entities, tables, APIs, frontend calls, auth rules, folders, and dependencies.
4. `plannerAgent` converts the blueprint into seven implementation phases: setup, models, middleware, backend, frontend, integration, and documentation.
5. `setupSandbox` creates an isolated sandbox and starts the local runtime environment.
6. `selectNextTask` picks the next pending task from the current phase.
7. `contextBuilder` creates a small task-specific context package for the coder.
8. `coderAgent` writes the requested files into the sandbox.
9. `updateRegistry` records exports and import interfaces from generated files.
10. `reviewerAgent` reviews generated code before execution.
11. `executorAgent` runs real checks.
12. `debuggerAgent`, `simplifyTask`, and `humanEscalation` handle failures.
13. `snapshotManager` checkpoints completed tasks.
14. `deploymentVerifier` generates Docker files and verifies the local app.
15. `presentToUser` prints the sandbox path and URLs.

## Fixed Versus Dynamic Behavior

The generated app is dynamic inside a controlled template.

Dynamic:

- app entities
- database tables
- API endpoints
- frontend pages
- generated files
- task breakdown
- PostgreSQL versus MongoDB selection

Fixed:

- Node/Express backend
- React/Vite frontend
- Tailwind styling
- expected backend and frontend folder layout
- expected major versions for core packages
- Docker deployment convention

The validator intentionally checks fixed folders and package families so the generated app can be installed, executed, and Dockerized consistently.

## Requirements

- Node.js 20 or compatible local Node runtime
- npm
- Docker with Docker Compose
- Gemini API key in `.env`

Create `.env`:

```bash
GEMINI_API_KEY=your-key-here
```

Optional settings:

```bash
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_TIMEOUT_MS=120000
GEMINI_MAX_TOKENS=8192
GRAPH_RECURSION_LIMIT=500
```

## Install

```bash
npm install
```

## Run

```bash
npm start
```

When prompted, enter a requirement such as:

```text
Build a simple personal todo app with register, login, CRUD todos, filters, due date, priority, and PostgreSQL.
```

The generated project appears in:

```text
sandboxes/<sandbox-id>
```

If deployment verification succeeds, open:

```text
Frontend: http://localhost:15173
Backend:  http://localhost:15000
```

To stop the generated app:

```bash
cd sandboxes/<sandbox-id>
docker compose down
```

## Tests

```bash
npm run test:graph
npm run test:pm
npm run test:validator
npm run test:planner
npm run test:sandbox
```

## Important Concepts

`taskQueue` stores phases and tasks created by the planner.

`selectNextTask` picks the first pending task, marks it `in_progress`, and sends it to the coding loop.

`contextBuilder` gives the coder only the context needed for the current task. It includes the task, dependency contract, naming map, previous file interfaces, database schema for backend work, and API endpoints for frontend work.

`fileRegistry` records exports and import statements from already generated files. Later tasks use it to import previous files correctly.

`namingMap` keeps entity names, table names, API paths, model file names, and route file names aligned.

`deploymentVerifier` creates Docker artifacts deterministically instead of asking the LLM to write them.

## Scope For Future Improvements

- Add Redis checkpointing for resumable graph runs.
- Add token budgets, state compaction, and cost reporting.
- Add configurable stack profiles instead of hardcoded Node/Express and React/Vite rules.
- Add latest-compatible dependency resolution from package metadata.
- Replace LLM-only registry extraction with AST-based extraction.
- Add Playwright checks for generated frontend behavior.
- Add generated API contract tests from the blueprint.
- Add cleanup commands for old sandboxes and Docker containers.
- Add better retry backoff for Gemini quota handling.
- Add optional deployment targets such as Render, Vercel, Neon, or Fly.io.
