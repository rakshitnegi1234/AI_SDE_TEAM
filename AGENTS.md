# AI Software Development Team - Project Context

This project is an autonomous multi-agent software builder. It should take a user requirement, clarify it, design the system, plan implementation tasks, write code, run the project in Docker, debug real errors, collect user feedback, and prepare deployment files with strong safety controls.

Build this project phase by phase only. Do not attempt to implement the entire system in one pass.

## Core Principle

The system must not ask one LLM call to design and build a whole project. It should break work into narrow, verifiable steps. Smaller agent calls are easier to validate, cheaper to retry, and safer to debug.

## High-Level Workflow

1. User provides a requirement.
2. PM Agent clarifies the spec.
3. Architect Agent designs entities, database schema, APIs, frontend pages, and folder structure.
4. Blueprint Validator checks the design for consistency.
5. Planner Agent creates dependency-ordered phased tasks.
6. Docker Sandbox is created and health checked.
7. Development loop writes, reviews, executes, debugs, and snapshots code.
8. User tests the app and gives feedback.
9. Deploy Agent creates deployment files and instructions.

## System Boundary

- LangGraph controls agent orchestration, graph nodes, state transitions, retries, and checkpoints.
- Gemini performs reasoning and code generation through structured agent prompts.
- Docker provides an isolated runtime for npm, database, backend, frontend, stdout, and stderr.
- Redis stores LangGraph checkpoints so a workflow can resume after interruption.
- Git inside Docker stores safe snapshots and rollback tags.
- Pinecone can store long-term memory or project-level retrieval for larger codebases.

## Fixed Generated App Stack

V2 intentionally keeps generated projects fixed to:

- Frontend: React with Vite
- Backend: Node.js with Express
- Database: PostgreSQL via Neon or MongoDB via Atlas
- Execution: Docker sandbox
- Deployment: Vercel, Render, and Neon or Atlas

This reduces architectural randomness and helps agents maintain consistent quality. More stacks can be added later after the first version is reliable.

## Database Selection Rule

- Choose PostgreSQL when data has clear relationships, joins, constraints, transactions, and reporting needs.
- Choose MongoDB when data is flexible, nested, document-like, and likely to evolve frequently.

## Agent Responsibilities

- PM Agent: Clarifies requirements, removes ambiguity, and produces a clean product spec.
- Architect Agent: Designs entities, DB schema, API contracts, frontend pages, folder structure, and dependencies.
- Planner Agent: Converts the validated blueprint into phased, dependency-ordered implementation tasks.
- Coder Agent: Writes code for one task at a time using only relevant context and project patterns.
- Reviewer Agent: Checks code for bugs, security issues, blueprint compliance, integration, and style consistency.
- Executor Agent: Runs commands in Docker and captures real stdout/stderr.
- Debugger Agent: Reads real errors, traces root causes, suggests fixes, and can trigger rollback.
- Deploy Agent: Creates deployment configs, environment examples, and free-tier deployment instructions.

## LangGraph 30-Node Workflow

### Phase A - Requirement Clarification

1. `pmAgent`: Reads raw user requirement, detects ambiguity, asks up to 5-8 clarifying questions, or produces a clean spec.
2. `humanInput`: Collects answers from the user and sends them back to PM Agent.

### Phase B - Architecture Design

3. `architectStep1`: Identify all entities and relationships from the spec.
4. `architectStep2`: Design database schema with fields, types, constraints, and foreign keys.
5. `architectStep3`: Design API endpoints with method, path, auth, role access, request, and response.
6. `architectStep4`: Design frontend routes, pages, components, and API calls.
7. `architectStep5`: Generate folder structure and package.json dependencies with versions.
8. `blueprintValidator`: Cross-check schema, APIs, pages, auth, entity coverage, and relationships. Route back to the failing architect step if invalid.

### Phase C - Planning And Sandbox Setup

9. `plannerAgent`: Break the blueprint into phases and tasks. Mark tasks as parallelizable only when safe.
10. `setupSandbox`: Create Docker project, write package.json, install dependencies, create DB service, and initialize Git.
11. `sandboxHealthCheck`: Verify node_modules, DB connection, ports, Git status, and disk space.

### Phase D - Development Loop

12. `selectNextTask`: Pick the next pending task or safe parallel task group.
13. `phaseVerification`: Run phase-level checks such as DB connection, API responses, and frontend render.
14. `patternExtractor`: Extract coding patterns from the completed phase.
15. `stateCompactor`: Compact old state and registry data to control token growth.
16. `contextBuilder`: Build minimal task-specific context.
17. `coderAgent`: Write or modify files for the current task using project patterns.
18. `updateRegistry`: Extract functions, exports, dependencies, and interfaces from new files.
19. `reviewerAgent`: Approve or reject code based on correctness, security, integration, and pattern compliance.
20. `simplifyTask`: Break repeatedly failing tasks into smaller subtasks.
21. `executorAgent`: Run code and tests in Docker and capture real output.
22. `snapshotManager`: Commit and tag successful task code for rollback.
23. `debuggerAgent`: Diagnose execution or phase verification failures using real errors and files.
24. `humanEscalation`: Ask the user for guidance, task skip, or feature simplification when automated recovery fails.

### Phase E - Presentation, Feedback, And Deployment

25. `presentToUser`: Start project in Docker, expose URL, and show feature, token, and cost summaries.
26. `feedbackCollector`: Classify feedback into bugs, changes, and new features. Calculate scope drift.
27. `feedbackRouter`: Convert feedback into debug tasks, modification tasks, or new feature plans.
28. `deployAgent`: Generate `vercel.json`, `render.yaml`, `Dockerfile`, `.env.example`, and deployment instructions.

Additional implicit systems:

- Checkpointing runs after every node and persists state.
- Token tracking wraps every LLM call and records input tokens, output tokens, estimated cost, and budget warnings.

## Context Management

Each agent call is separate. A Coder Agent working on Task 20 does not automatically remember code written in Tasks 1-19. Passing the entire codebase into every prompt is expensive and eventually impossible.

Use a File Interface Registry instead of storing full code in state. The registry stores concise summaries:

- Function names
- Arguments
- Return values
- Exports
- Dependencies
- Side effects

Example:

```text
backend/middleware/auth.js
authenticateToken(req, res, next)
does: verifies JWT from Authorization header
sets: req.user = { id, email, role }
returns: next() or 401
exports: authenticateToken
```

Coder task context should include only:

- Task description
- DB schema when relevant
- Relevant file interfaces from `filesNeeded`
- Project patterns
- Targeted library docs only when needed

Use state selectors so each node receives only the fields it needs.

## Knowledge Tools

Give Gemini targeted documentation retrieval tools to reduce library-specific hallucinations:

- `check_library_version`: Calls npm registry latest endpoint and detects major version changes.
- `fetch_library_docs`: Fetches targeted official docs for known libraries such as Express, React, pg, and Mongoose.
- `search_web_docs`: Fallback search for unfamiliar libraries, prioritizing official documentation.
- `fetch_code_examples`: Retrieves real code examples from GitHub to understand idiomatic usage.

These tools should be called only when needed.

## Docker Sandbox Design

Docker is required because LLMs cannot prove generated code works without a real runtime. The sandbox provides filesystem, npm, database, ports, stdout/stderr, and host isolation.

Baseline Docker Compose:

```yaml
services:
  app:
    image: node:20
    working_dir: /project
    ports:
      - "5000:5000"
      - "5173:5173"
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: projectdb
```

Sandbox manager methods:

- `createSandbox(projectId)`
- `writeFile(sandboxId, path, content)`
- `readFile(sandboxId, path)`
- `executeCommand(sandboxId, command, timeout)`
- `getFileList(sandboxId)`
- `destroySandbox(sandboxId)`
- `healthCheck(sandboxId)`
- `snapshot(sandboxId, message)`
- `rollback(sandboxId, tag)`

## Error Recovery And Rollback

The Debugger Agent must not guess. It must read actual error output, inspect relevant files, and trace the real root cause.

Recovery tiers:

- Tier 1: Self-fix. Debugger reads error output, suggests a direct fix, Coder applies it, Executor retests. Maximum 3 attempts.
- Tier 2: Broader context. Debugger reads more project files to locate deeper integration problems. Maximum 2 attempts.
- Tier 2.5: Rollback and retry. Roll back to the last known good Git tag and retry the task from scratch once.
- Tier 3: Human escalation. Ask the user to provide guidance, skip the task, or simplify the feature.

Rollback command:

```bash
git checkout task-{lastGoodTaskId} -- .
```

Rollback only works because `snapshotManager` commits and tags after every successful task.

## Feedback Loop And Scope Control

After the project runs, the user can test it in the browser. Feedback is classified as:

- Bugs: Create debug tasks and route to Debugger Agent.
- Changes: Create modification tasks and route to Coder Agent.
- New features: Route to Planner Agent so tasks are designed and ordered correctly.

Scope drift rule:

- Calculate scope drift from 0.0 to 1.0.
- Warn the user if scope drift exceeds 0.4.
- Maximum feedback iterations: 3.
- The user can continue, but the risk must be explicit.

## Agent Prompting Principles

Every agent prompt should use a strict structure:

- ROLE
- GOAL
- BOUNDARIES
- INPUT
- OUTPUT
- RULES

Critical prompt rules:

- PM Agent asks a maximum of 5-8 clarifying questions and can choose obvious defaults.
- Architect Agent is split into 5 smaller calls.
- Blueprint Validator cross-checks architecture outputs against each other.
- Planner tasks must include `filesNeeded`, dependencies, acceptance criteria, and `canParallelize`.
- Coder works on one task and follows `projectPatterns`.
- Reviewer does not force approve; after repeated rejection, it triggers `simplifyTask`.
- Executor captures full error output and tests success and failure cases.
- Debugger never guesses; it reads actual errors and actual files.
- Deploy Agent uses free-tier deployment platforms only.

## Token Tracking And Budget Control

Wrap every LLM call with token tracking:

- Record agent name.
- Estimate input tokens.
- Estimate output tokens.
- Track timestamp.
- Update total input and output tokens.
- Estimate cost.
- Warn at 80% budget usage.
- Pause when budget is exceeded and ask whether to continue.
- Show per-agent token usage in the final project summary.

Default budget should be configurable, for example:

- Small projects: `$2`
- Larger projects: `$10`

## Checkpoint And State Persistence

Use a LangGraph Redis checkpointer.

```js
import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";

const checkpointer = new RedisSaver({
  url: process.env.REDIS_URL
});

const graph = new StateGraph({ channels: stateShape })
  .addNode("pmAgent", pmAgentFn)
  // ... all other nodes
  .compile({ checkpointer });
```

Resume behavior:

- Each project run has a unique `threadId`.
- After every node completes, LangGraph serializes state to Redis.
- On restart, the system loads the last state using `graph.getState(threadId)`.
- The user can resume with a command such as: `continue my project`.

## LangGraph State Shape

State groups:

- User and PM state: `userRequirement`, `clarifiedSpec`
- Architecture state: `blueprint.entities`, `dbSchema`, `apiEndpoints`, `frontendPages`, `folderStructure`, `dependencies`
- Validation state: `blueprintValidation.isValid`, `issues`, `validationCycles`
- Planning state: `taskQueue`, `currentPhaseIndex`, `currentTaskIndex`
- Code context state: `fileRegistry`, `projectPatterns`
- Sandbox state: `sandboxId`, `sandboxHealthy`
- Review/execution/debug state: `reviewResult`, `executionResult`, `debugState`
- Feedback state: `userFeedback`, `feedbackIteration`, `scopeDrift`, `userSatisfied`
- Deployment state: `deploymentConfig`
- Cost state: `tokenUsage`, `tokenBudget`
- Control state: `currentPhase`

Do not store every full file forever in state. Full files live in Docker. State stores interfaces, summaries, task records, and metadata.

## Required Build Order

Implement incrementally in this order:

1. Set up LangGraph skeleton with state, empty nodes, and Redis checkpointer.
2. Implement PM Agent so one end-to-end clarification path works.
3. Implement Architect Agent in 5 separate steps.
4. Implement Blueprint Validator.
5. Implement Planner Agent with `canParallelize` flags.
6. Build Docker sandbox manager with Git init and health check support.
7. Implement `sandboxHealthCheck` node.
8. Implement `contextBuilder` and Coder Agent with `projectPatterns` injection.
9. Implement `updateRegistry`.
10. Implement Reviewer Agent with `simplifyTask` escalation.
11. Implement `simplifyTask` node.
12. Implement Executor Agent.
13. Implement `snapshotManager`.
14. Implement Debugger Agent with rollback capability.
15. Implement `patternExtractor`.
16. Implement `stateCompactor`.
17. Implement feedback loop with scope drift detection and iteration limits.
18. Implement Deploy Agent.
19. Add knowledge tools: check version, fetch docs, search web docs, fetch examples.
20. Implement token tracking wrapper.
21. Run testing and refinement.

## Known Limitations

- First version is fixed to React and Express projects only.
- Deploy Agent generates configs and instructions but does not auto-deploy with platform API tokens.
- The system supports one user/project run at a time unless sandbox orchestration is scaled.
- Very large projects still face context-window constraints.
- Parallel execution is limited to independent tasks inside the same phase.

## Future Improvements

- MCP integration for broader tool ecosystem.
- Support for more stacks such as Next.js and Python/FastAPI.
- Auto-deployment using Vercel, Render, Neon, and Atlas API tokens.
- Cross-phase parallel execution when dependency graph allows it.
- Cloud sandbox such as E2B for multi-user scaling.
- Pinecone-based code retrieval for 100+ file projects.
- Dedicated test generation agent for unit and integration tests.

## Interview Explanation

30-second explanation:

I designed an autonomous multi-agent software development system using LangGraph in JavaScript. The system takes a user requirement, clarifies it, creates a database/API/frontend blueprint, validates the blueprint, breaks it into dependency-ordered tasks, writes code task by task, runs it inside Docker, debugs real errors, snapshots working states with Git, collects user feedback, and prepares deployment configs. V2 adds production safeguards like Redis checkpointing, rollback, token budgeting, state compaction, pattern extraction, and scope drift detection.

Strong explanation:

The main challenge is not just generating code. The hard part is designing a controlled autonomous workflow where every generated step can be validated, executed, debugged, recovered, and resumed. That is why this project uses LangGraph nodes, Docker execution, Redis checkpoints, Git snapshots, strict JSON outputs, token budgeting, rollback, and scope drift control.
