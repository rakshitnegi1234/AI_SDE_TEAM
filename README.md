# AI Team App Builder

AI Team App Builder is a multi-agent full-stack app generation system. A user enters a plain English requirement, and the system turns it into a validated app blueprint, an ordered task plan, generated source files, runtime checks, debugger retries, sandbox snapshots, and a final runnable generated app preview.

This repository is split into:

- `backend/`: Node.js control server, REST API, WebSocket server, LangGraph pipeline, Gemini integration, and sandbox manager.
- `frontend/`: React/Vite dashboard UI used to submit requirements and watch the pipeline run in real time.

The generated apps created by this system have their own internal structure inside `sandboxes/<sandbox-id>/`, usually:

```text
backend/
  src/
frontend/
  src/
```

That generated app structure is separate from this repository's top-level `backend/` and `frontend/` folders.

## What It Does

- Converts a user requirement into a clarified product spec.
- Designs entities, database schema, REST APIs, frontend pages, folder structure, and dependencies.
- Validates architecture and task plans before code generation.
- Creates an isolated generated-app workspace.
- Uses Docker containers when Docker is available.
- Generates files one task at a time with focused context.
- Runs install/build/runtime checks after generated files are written.
- Sends failures into a debugger loop for targeted repair.
- Saves Git snapshots inside the generated sandbox after successful tasks.
- Streams live pipeline events to the frontend over WebSockets.

## Stack

Control app:

- Backend: Node.js, native HTTP server, LangGraph, Gemini API
- Frontend: React 18, Vite, Zustand
- Realtime: WebSocket endpoint at `/ws`
- Runtime isolation: Docker when available, local fallback otherwise
- Checkpointing: LangGraph `MemorySaver` by default, Redis when `REDIS_URL` is configured

Generated apps:

- Backend: Node.js, Express, ES modules
- Frontend: React, Vite, Tailwind CSS
- Database: PostgreSQL or MongoDB

## Architecture

<img width="986" height="773" alt="image" src="https://github.com/user-attachments/assets/8544c9a5-bd01-45f6-974b-d103378b4fd4" />

`setupSandbox` includes the sandbox health check. There is no separate `sandboxHealthCheck` node in the current graph.

## Pipeline

1. `pmAgent` clarifies the requirement or produces a structured product spec.
2. `humanInput` collects clarification answers when needed.
3. `architectStep1` defines entity names, table names, API paths, model file names, and route file names.
4. `architectStep2` designs the database schema and chooses PostgreSQL or MongoDB.
5. `architectStep3` designs REST API endpoints.
6. `architectStep4` designs frontend pages, routes, and components.
7. `architectStep5` defines folder structure and dependencies.
8. `blueprintValidator` checks the architecture contract.
9. `plannerAgent` creates the implementation task plan.
10. `plannerValidator` checks task order, file coverage, and path safety.
11. `setupSandbox` creates the generated workspace, containers, database, and health checks.
12. `selectNextTask` picks the next pending task.
13. `contextBuilder` builds focused context for the current task.
14. `coderAgent` writes the requested files.
15. `updateRegistry` indexes exports, imports, API calls, and response shapes.
16. `executorAgent` runs real checks.
17. `debuggerAgent` repairs failed tasks.
18. `snapshotManager` marks passing tasks done and snapshots the sandbox.
19. `presentToUser` returns the final state and generated app URL.

## Install

Requirements:

- Node.js 20+
- npm
- Docker Engine for the best sandbox experience
- Gemini API key

Install dependencies:

```bash
npm install
npm --prefix frontend install
```

Create `.env` in this directory:

```bash
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MAX_TOKENS=8192
GEMINI_TIMEOUT_MS=120000
GEMINI_REQUESTS_BEFORE_SLEEP=14
GEMINI_REQUEST_SLEEP_MS=58000
GEMINI_MAX_RETRY_ATTEMPTS=6
GRAPH_RECURSION_LIMIT=500
```

Optional runtime settings:

```bash
PORT=3000
SANDBOX_DIR=/tmp/ai-sde-sandboxes
GENERATED_BACKEND_PORT=5000
GENERATED_FRONTEND_PORT=5173
REDIS_URL=redis://localhost:6379
```

Never commit `.env`.

## Run Locally

Build the frontend and start the backend server:

```bash
npm run build
npm start
```

Open:

```text
http://localhost:3000
```

For frontend-only development:

```bash
npm run dev:frontend
```

The frontend defaults to `VITE_API_URL=/api` and the WebSocket hook defaults to the current host. That works when the Node backend serves `frontend/dist`.

## Scripts

```bash
npm start        # run backend/server.js
npm run dev      # same as npm start
npm run cli      # run backend/index.js terminal flow
npm run build    # install/build frontend
npm run dev:frontend
```

## Frontend Environment

For local single-server mode, this is enough:

```bash
VITE_API_URL=/api
```

For split deployment, set these in Vercel:

```bash
VITE_API_URL=https://api.example.com/api
VITE_WS_URL=wss://api.example.com
```

The frontend connects to:

```text
REST: ${VITE_API_URL}/projects
WS:   ${VITE_WS_URL}/ws?projectId=<id>
```

## Deployment

Recommended deployment:

- Frontend on Vercel from `frontend/`
- Backend on EC2 from this repository root
- Nginx on EC2 for HTTPS and WebSocket proxying

See the full deployment runbook:

```text
../deploy.md
```

Important deployment settings for EC2:

```bash
PORT=3000
SANDBOX_DIR=/opt/ai-team/AI_SDE_TEAM/sandboxes
PUBLIC_APP_BASE_URL=http://ec2-public-ip-or-domain
GENERATED_BIND_HOST=0.0.0.0
```

Use `PUBLIC_APP_BASE_URL` and `GENERATED_BIND_HOST=0.0.0.0` only when generated app preview ports should be reachable from outside EC2. Otherwise generated containers stay bound to `127.0.0.1`.

## Validation Rules

`blueprintValidator` checks:

- PM database recommendation matches the architecture database type.
- Auth-required apps include user/auth contracts.
- PM page routes exist in `frontendPages`.
- API endpoints use valid methods and `/api/v1` paths.
- API endpoints reference real database tables.
- Frontend API calls match declared backend endpoints.
- Required backend/frontend files and dependencies exist in the blueprint.

`plannerValidator` checks:

- The seven phases are present in the expected order.
- Task paths are project-relative and safe.
- Setup files are scheduled before dependent files.
- Duplicate file creation is blocked except allowed integration updates.
- `filesNeeded` references only earlier generated files.
- Planner output covers the validated blueprint.

## Sandbox Behavior

When Docker is available, each generated app can get:

- PostgreSQL or MongoDB container
- Redis container
- backend Node container
- frontend Node container

When Docker is unavailable, the system falls back to local execution in the generated sandbox folder.

Generated sandboxes are written under `SANDBOX_DIR` or `sandboxes/` by default. Do not commit generated sandboxes.

## Known Limitations

- Active project state is in memory unless Redis checkpointing is configured.
- The current WebSocket implementation is minimal and project-specific.
- Generated apps are development previews, not hardened production apps.
- Public generated preview ports require careful EC2 security group rules.
- Old Docker containers and sandboxes should be cleaned periodically.
- There is no full CI test suite yet.

