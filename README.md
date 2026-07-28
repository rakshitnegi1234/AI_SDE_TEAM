# AI Team App Builder

AI Team App Builder is a local multi-agent software generation system. It takes a plain English requirement, clarifies the product scope, designs a full-stack architecture blueprint, validates that blueprint, creates an implementation plan, generates code one task at a time, executes real checks, debugs failures, snapshots successful work, and presents the generated project output.

The project is intentionally built as a controlled pipeline instead of asking one model call to design and build an entire application. Each agent has a narrow job, and validators enforce consistency between phases.

The current supported generated app stack is intentionally constrained:

- Backend: Node.js, Express, ES modules
- Frontend: React, Vite, Tailwind CSS
- Database: PostgreSQL or MongoDB
- Runtime: local sandbox folder, Docker containers when Docker is available
- Dashboard: React/Vite dashboard served by the Node server
- Checkpointing: LangGraph `MemorySaver` by default, Redis-backed when `REDIS_URL` is configured

## Architecture Diagram
<img width="986" height="773" alt="image" src="https://github.com/user-attachments/assets/8544c9a5-bd01-45f6-974b-d103378b4fd4" />


## Workflow

1. `pmAgent` reads the raw requirement and either asks targeted clarification questions or produces a structured product spec.
2. `humanInput` collects clarification answers when the PM agent needs more information.
3. `architectStep1` creates the entity naming map: entity names, table names, API paths, model file names, and route file names.
4. `architectStep2` designs the database schema and database choice.
5. `architectStep3` designs REST API endpoints.
6. `architectStep4` designs frontend pages, routes, layouts, and page components.
7. `architectStep5` creates the folder structure and dependency contract.
8. `blueprintValidator` validates the architecture against the PM spec and internal blueprint contracts.
9. `plannerAgent` converts the validated blueprint into seven ordered implementation phases: setup, models, middleware, backend, frontend, integration, and documentation.
10. `plannerValidator` checks that the task plan strictly follows the validated blueprint and can execute sequentially.
11. `setupSandbox` creates a local sandbox folder and starts Docker containers when Docker is available.
12. `sandboxHealthCheck` verifies that the workspace, containers, and database are usable before code generation starts.
13. `selectNextTask` chooses the next pending task and marks it `in_progress`.
14. `contextBuilder` builds the smallest useful context package for the current coding task.
15. `coderAgent` writes or updates only the files requested by the current task.
16. `updateRegistry` extracts public interfaces from generated files and stores them in `fileRegistry`.
17. `executorAgent` installs dependencies when needed and runs real backend/frontend checks.
18. `debuggerAgent` reads real errors, inspects relevant files, and sends targeted repair context back through the coding loop.
19. `snapshotManager` marks successful tasks done, clears task-local state, and saves a Git snapshot inside the sandbox when available.
20. `presentToUser` prints the generated project location and summary.

## Agent Responsibilities

`pmAgent`

Clarifies product scope. It focuses on user roles, permissions, workflows, business objects, database recommendation, and pages. It does not ask the user to choose implementation tools because the stack is fixed.

`architectAgent`

Builds the architecture in five small steps. The most important contract is the naming map from Step 1. Later steps must follow it exactly. For example, if `modelFile` is `task`, the model file is `backend/src/models/task.js`.

`blueprintValidator`

Checks that the architecture is internally consistent and aligned with the PM spec. It validates database choice, auth coverage, page coverage, role access, entity-table mapping, foreign keys, API-table references, frontend API calls, auth rules, required folder paths, and required dependencies.

`plannerAgent`

Creates a task plan from the validated blueprint. It must follow the blueprint exactly. It should not invent new entities, APIs, folders, files, dependencies, pages, or components.

`plannerValidator`

Checks that the plan can be executed safely. It validates the seven mandatory phases, task shape, path safety, setup requirements, file counts, dependency order, duplicate creation, README placement, entity model/route file names, and complete coverage of the architect folder structure.

`coderAgent`

Generates the file contents for one task at a time. It receives only task-specific context, not the whole generated codebase.

`updateRegistry`

Indexes the files written by the coder. It records exports, suggested import statements, and interface summaries. Later coder tasks use this registry to import previous files correctly without loading all earlier code.

`executorAgent`

Runs real checks in the sandbox. It installs backend/frontend dependencies when package files exist, runs build/test scripts when available, and captures stdout/stderr.

`debuggerAgent`

Uses actual execution errors and file contents to identify a root cause. It can retry with more context and can roll back to a previous sandbox snapshot after repeated failures.

`snapshotManager`

Marks the current task as done after execution passes. It also resets temporary state such as `currentTask`, `contextPackage`, `coderOutput`, `executionResult`, and debugger state.

## Validation Strategy

The project uses two separate validators because architecture correctness and task-plan correctness are different problems.

`blueprintValidator` checks the architecture:

- PM database recommendation matches the architecture database type.
- Auth-required apps include a `User` entity and register/login API endpoints.
- PM page routes exist in `frontendPages`.
- Endpoint roles match PM roles.
- Entities map to real database tables.
- Foreign keys reference real tables.
- API `relatedTable` values reference real tables.
- Frontend API calls match declared API endpoints.
- Pages that call protected APIs are marked `requiresAuth`.
- Required backend/frontend folder paths exist.
- Required package dependencies exist with expected major versions.
- Entity naming contracts match folder structure, such as `modelFile: "task"` requiring `backend/src/models/task.js`.

`plannerValidator` checks the plan:

- Exactly seven phases exist in this order: setup, models, middleware, backend, frontend, integration, documentation.
- Each task has `taskId`, `filesToCreate`, `filesNeeded`, and `canParallelize`.
- Paths are project-relative and safe.
- Each task creates at most three files.
- Required setup files appear in setup.
- Auth setup files appear when auth is required.
- Duplicate file creation is blocked except for allowed integration updates to `backend/src/index.js` and `frontend/src/App.jsx`.
- `filesNeeded` only references files created by earlier tasks.
- Every architect folder file is scheduled.
- Planner does not create random files outside the validated blueprint, except `.gitignore` and `README.md`.

This makes the data flow strict:

```text
PM spec -> validated blueprint -> validated task plan -> sandbox execution
```

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

The validator intentionally checks fixed folders and package families so the generated app can be installed and executed consistently.

## Sandbox And Execution

The sandbox is created by `createSandbox(folderStructure, dependencies, dbSchema)`.

`folderStructure` is used to create the generated app workspace directories.

`dependencies` is used to detect whether the generated app should use PostgreSQL or MongoDB. If backend dependencies include `mongoose`, MongoDB is selected. Otherwise PostgreSQL is selected.

`dbSchema` is used to create PostgreSQL tables when PostgreSQL is selected.

When Docker is available, the sandbox manager starts local Docker containers:

- database container: PostgreSQL or MongoDB
- Redis container
- backend Node container
- frontend Node container

When Docker is not available, the sandbox manager falls back to local-only mode. In that case, files are still created locally, but commands run on the host machine instead of inside Docker containers.

`sandboxHealthCheck` runs before the coding loop. It verifies that the sandbox folder exists, backend/frontend folders exist, Git is initialized when snapshots are enabled, containers respond when Docker is enabled, and the database is reachable.

## Snapshot And Rollback

After a task passes execution, `snapshotManager` marks the task as done and attempts to save a Git snapshot inside the generated sandbox. This Git repository is not the main project repository. It is only an undo mechanism for generated code.

If debugging repeatedly fails, `debuggerAgent` can roll back the sandbox to the last known good snapshot and retry the same task from a cleaner state. After rollback, `contextBuilder` passes rollback metadata to `coderAgent` so the coder knows that files were restored and should preserve working interfaces.

Rollback is a fallback path. The normal debugging loop is:

```text
executorAgent fails -> debuggerAgent -> contextBuilder -> coderAgent -> updateRegistry -> executorAgent
```

Rollback only happens after repeated failed repair attempts.

## Dashboard Server

`npm start` runs `src/server.js`.

The server provides:

- static dashboard assets from `dashboard/dist`
- REST endpoints under `/api`
- WebSocket updates under `/ws`
- in-memory active project tracking
- project creation, cancel, resume, sandbox info, and file-read endpoints

The dashboard lets the user submit a requirement, monitor pipeline events, answer PM clarification questions, inspect blueprint/task/code outputs, and view the final sandbox result.

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
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_TIMEOUT_MS=120000
GEMINI_MAX_TOKENS=8192
GEMINI_REQUESTS_BEFORE_SLEEP=14
GEMINI_REQUEST_SLEEP_MS=58000
GEMINI_MAX_RETRY_ATTEMPTS=6
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

Open:

```text
http://localhost:3000
```

Enter a requirement such as:

```text
Build a simple personal todo app with register, login, CRUD todos, filters, due date, priority, and PostgreSQL.
```

The generated project appears in:

```text
sandboxes/<sandbox-id>
```

## Important Concepts

`taskQueue` stores phases and tasks created by the planner.

`selectNextTask` picks the first pending task, marks it `in_progress`, and sends it to the coding loop.

`contextBuilder` gives the coder only the context needed for the current task. It includes the task, dependency contract, naming map, previous file interfaces, database schema for backend work, and API endpoints for frontend work.

`fileRegistry` records exports and import statements from already generated files. Later tasks use it to import previous files correctly.

`namingMap` keeps entity names, table names, API paths, model file names, and route file names aligned.

`createCheckpointer` selects Redis checkpointing when `REDIS_URL` is present in the Docker runtime and falls back to `MemorySaver` otherwise.

`debugState` tracks debugger tier, retry attempts, whether rollback was attempted, and rollback context for the coder.

`executionResult` stores the latest executor pass/fail result plus command output and errors.

`coderOutput` stores the latest files written by the coder agent.

`blueprintValidation` and `plannerValidation` store validator results and repair-cycle counts.

## Scope For Future Improvements

- Add stronger Redis checkpointing for resumable dashboard project runs.
- Add configurable stack profiles instead of hardcoded Node/Express and React/Vite rules.
- Add latest-compatible dependency resolution from package metadata.
- Replace LLM-only registry extraction with AST-based extraction.
- Add Playwright checks for generated frontend behavior.
- Add generated API contract tests from the blueprint.
- Add cleanup commands for old sandboxes and Docker containers.
- Add better retry backoff for Gemini quota handling.
- Add `reviewerAgent` between `updateRegistry` and `executorAgent` to review generated code before runtime execution.
- Add `simplifyTask` node for cases where a task is too large or repeatedly fails and should be split into smaller subtasks.
- Add richer human intervention flows for debugger escalation, manual guidance, task skipping, and scope reduction.
- Add user feedback collection after final presentation so future PM, architecture, and planning decisions can improve.
