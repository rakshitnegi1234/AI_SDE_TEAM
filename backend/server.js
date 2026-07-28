import { createHash, randomUUID } from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import {
  architectStep1Node,
  architectStep2Node,
  architectStep3Node,
  architectStep4Node,
  architectStep5Node,
} from "./agents/architectAgent.js";
import {
  blueprintValidatorNode,
  blueprintValidatorRouter,
} from "./agents/blueprintValidator.js";
import { coderAgentNode } from "./agents/coderAgent.js";
import { debuggerAgentNode } from "./agents/debuggerAgent.js";
import { executorAgentNode } from "./agents/executorAgent.js";
import { plannerAgentNode } from "./agents/plannerAgent.js";
import {
  plannerValidatorNode,
  plannerValidatorRouter,
} from "./agents/plannerValidator.js";
import { pmAgentNode } from "./agents/pmAgent.js";
import { contextBuilderNode } from "./nodes/contextBuilder.js";
import { presentToUserNode } from "./nodes/presentToUser.js";
import { selectNextTaskNode } from "./nodes/selectNextTask.js";
import { setupSandboxNode } from "./nodes/setupSandbox.js";
import { snapshotManagerNode } from "./nodes/snapshotManager.js";
import { updateRegistryNode } from "./nodes/updateRegistry.js";
import { initGemini } from "./utils/gemini.js";
import { getSandboxPath, readFile, startGeneratedApp } from "./utils/sandboxManager.js";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const frontendDist = path.join(projectRoot, "frontend", "dist");
const frontendIndex = path.join(frontendDist, "index.html");
const projects = new Map();

const server = http.createServer(handleHttpRequest);
server.on("upgrade", handleWebSocketUpgrade);

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`AI Team backend server running on http://localhost:${port}`);
});

async function handleHttpRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApiRequest(req, res, url);
      return;
    }

    serveStaticFile(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function handleApiRequest(req, res, url) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    const body = await readJsonBody(req);
    const requirement = String(body.requirement || "").trim();

    if (!requirement) {
      sendJson(res, 400, { error: "Requirement is required" });
      return;
    }

    const activeProject = findActiveProject();
    if (activeProject) {
      sendJson(res, 409, {
        error: "A project is already running. Wait for it to finish or cancel it before starting another.",
        projectId: activeProject.id,
        status: activeProject.status,
      });
      return;
    }

    const project = createProject(requirement);
    sendJson(res, 201, {
      projectId: project.id,
      status: project.status,
    });

    setImmediate(() => runProject(project).catch((error) => failProject(project, error)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    sendJson(res, 200, {
      projects: Array.from(projects.values()).map(projectSummary),
    });
    return;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/);
  if (!projectMatch) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const project = projects.get(projectMatch[1]);
  const action = projectMatch[2] || "";

  if (!project) {
    sendJson(res, 404, { error: "Project not found" });
    return;
  }

  if (req.method === "GET" && action === "") {
    sendJson(res, 200, projectSummary(project));
    return;
  }

  if (req.method === "POST" && action === "resume") {
    if (project.status === "error") {
      project.status = "running";
      emit(project, { type: "run_started" });
      setImmediate(() => runProject(project).catch((error) => failProject(project, error)));
    }

    sendJson(res, 200, { ok: true, status: project.status });
    return;
  }

  if (req.method === "POST" && action === "input") {
    const body = await readJsonBody(req);

    if (!resolveHumanInput(project, body.data || body)) {
      sendJson(res, 409, { error: "Project is not waiting for input" });
      return;
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && action === "cancel") {
    project.cancelled = true;
    project.status = "cancelled";
    emit(project, { type: "run_cancelled" });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && action === "sandbox") {
    sendJson(res, 200, {
      sandboxId: project.state?.sandboxId || "",
      sandboxPath: getProjectSandboxPath(project),
    });
    return;
  }

  if (req.method === "GET" && action.startsWith("files/")) {
    const filePath = decodeURIComponent(action.slice("files/".length));
    sendJson(res, 200, {
      path: filePath,
      content: readFile(project.state.sandboxId, filePath),
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function createProject(requirement) {
  const project = {
    id: randomUUID(),
    requirement,
    status: "queued",
    events: [],
    clients: new Set(),
    cancelled: false,
    waitingForHumanInput: null,
    state: createInitialState(requirement),
  };

  projects.set(project.id, project);
  return project;
}

function findActiveProject() {
  return Array.from(projects.values()).find((project) =>
    ["queued", "running"].includes(project.status) && !project.cancelled
  );
}

function createInitialState(requirement) {
  return {
    userRequirement: requirement,
    pmStatus: "idle",
    pmQuestions: [],
    pmConversation: [],
    blueprint: {
      entities: [],
      dbSchema: {},
      apiEndpoints: [],
      frontendPages: [],
      sharedComponents: [],
      routingNotes: [],
      folderStructure: "",
      dependencies: {},
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
    plannerValidation: { isValid: false, issues: [], validationCycles: 0 },
    taskQueue: { phases: [] },
    taskStatuses: {},
    fileRegistry: [],
    debugState: { tier: 1, attempts: 0, maxAttempts: 3, rollbackAttempted: false, rollbackContext: null },
    appUrls: null,
  };
}

async function runProject(project) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required to run projects");
  }

  initGemini(process.env.GEMINI_API_KEY);
  project.status = "running";
  emit(project, { type: "run_started" });

  let state = project.state;
  state = await runPmPhase(project, state);
  state = await runArchitecturePhase(project, state);
  state = await runPlannerAndSandboxPhase(project, state);
  state = await runDevelopmentLoop(project, state);
  state = await runNode(project, "presentToUser", presentToUserNode, state);
  state = await launchGeneratedApp(project, state);

  project.state = state;
  project.status = "complete";
  emit(project, {
    type: "run_complete",
    finalState: buildFinalState(project),
  });
}

async function launchGeneratedApp(project, state) {
  if (!state.sandboxId) {
    return state;
  }

  emit(project, { type: "app_starting" });

  const appUrls = await startGeneratedApp(state.sandboxId);
  const nextState = mergeState(state, { appUrls });
  project.state = nextState;

  emit(project, {
    type: "app_started",
    appUrls,
  });

  return nextState;
}

async function runPmPhase(project, state) {
  emit(project, { type: "phase_change", phase: "pm" });

  state = await runNode(project, "pmAgent", pmAgentNode, state);

  while (state.pmStatus === "needs_clarification") {
    const answers = await waitForHumanInput(project, {
      inputType: "pm_clarification",
      questions: state.pmQuestions,
    });

    state = mergeState(state, {
      pmConversation: [
        { role: "pm", questions: state.pmQuestions },
        { role: "user", answers: answers.answers || answers },
      ],
    });

    state = await runNode(project, "pmAgent", pmAgentNode, state);
  }

  if (state.pmStatus !== "spec_ready") {
    throw new Error(`PM failed with status: ${state.pmStatus}`);
  }

  emit(project, { type: "spec_ready", spec: state.clarifiedSpec });
  return state;
}

async function runArchitecturePhase(project, state) {
  emit(project, { type: "phase_change", phase: "architect" });

  state = await runNode(project, "architectStep1", architectStep1Node, state);
  state = await runNode(project, "architectStep2", architectStep2Node, state);
  state = await runNode(project, "architectStep3", architectStep3Node, state);
  state = await runNode(project, "architectStep4", architectStep4Node, state);
  state = await runNode(project, "architectStep5", architectStep5Node, state);
  state = await runNode(project, "blueprintValidator", blueprintValidatorNode, state);

  let route = blueprintValidatorRouter(state);
  let fixes = 0;

  while (route !== "__end__" && fixes < 3) {
    const fixNode = {
      architectStep1: architectStep1Node,
      architectStep2: architectStep2Node,
      architectStep3: architectStep3Node,
      architectStep4: architectStep4Node,
      architectStep5: architectStep5Node,
    }[route];

    if (!fixNode) {
      break;
    }

    state = await runNode(project, route, fixNode, state);
    state = await runNode(project, "blueprintValidator", blueprintValidatorNode, state);
    route = blueprintValidatorRouter(state);
    fixes += 1;
  }

  if (!state.blueprintValidation?.isValid) {
    throw new Error("Blueprint validation failed");
  }

  emit(project, { type: "blueprint_update", blueprint: state.blueprint });
  emit(project, { type: "validation_result", validation: state.blueprintValidation });
  return state;
}

async function runPlannerAndSandboxPhase(project, state) {
  emit(project, { type: "phase_change", phase: "planner" });

  state = await runNode(project, "plannerAgent", plannerAgentNode, state);
  state = await runNode(project, "plannerValidator", plannerValidatorNode, state);

  let route = plannerValidatorRouter(state);
  let fixes = 0;

  while (route === "plannerAgent" && fixes < 4) {
    state = await runNode(project, "plannerAgent", plannerAgentNode, state);
    state = await runNode(project, "plannerValidator", plannerValidatorNode, state);
    route = plannerValidatorRouter(state);
    fixes += 1;
  }

  if (route !== "setupSandbox") {
    throw new Error("Planner validation failed");
  }

  emit(project, { type: "taskqueue_ready", taskQueue: state.taskQueue });

  state = await runNode(project, "setupSandbox", setupSandboxNode, state);

  if (!state.sandboxHealthy) {
    throw new Error(state.error || "Sandbox health check failed");
  }

  emit(project, {
    type: "sandbox_created",
    sandboxId: state.sandboxId,
    healthy: state.sandboxHealthy,
  });

  return state;
}

async function runDevelopmentLoop(project, state) {
  emit(project, { type: "phase_change", phase: "dev_loop" });

  while (!project.cancelled) {
    state = await runNode(project, "selectNextTask", selectNextTaskNode, state);

    if (!state.currentTask || state.currentPhase === "done") {
      return state;
    }

    emit(project, { type: "task_started", task: state.currentTask });
    emit(project, { type: "task_progress", statuses: state.taskStatuses });

    state = await runTaskAttempt(project, state);

    let retryCount = 0;
    while (state.executionResult?.result === "fail" && retryCount < 3 && !project.cancelled) {
      state = await runNode(project, "debuggerAgent", debuggerAgentNode, state);
      state = await runTaskAttempt(project, state);
      retryCount += 1;
    }

    if (state.executionResult?.result !== "pass") {
      throw new Error(state.executionResult?.errors || "Executor failed");
    }

    state = await runNode(project, "snapshotManager", snapshotManagerNode, state);
    emit(project, { type: "task_progress", statuses: state.taskStatuses });
  }

  throw new Error("Project was cancelled");
}

async function runTaskAttempt(project, state) {
  state = await runNode(project, "contextBuilder", contextBuilderNode, state);
  state = await runNode(project, "coderAgent", coderAgentNode, state);
  emit(project, { type: "code_written", files: state.coderOutput });

  state = await runNode(project, "updateRegistry", updateRegistryNode, state);
  state = await runNode(project, "executorAgent", executorAgentNode, state);
  emit(project, { type: "execution_result", execution: state.executionResult });

  return state;
}

async function runNode(project, nodeName, nodeFn, state) {
  throwIfCancelled(project);
  emit(project, { type: "node_start", node: nodeName });

  const update = await nodeFn(state);
  if (update?.error) {
    throw new Error(update.error);
  }

  const nextState = mergeState(state, update || {});
  project.state = nextState;

  emit(project, { type: "node_complete", node: nodeName });
  return nextState;
}

function mergeState(state, update) {
  const next = { ...state };

  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }

  if (update.blueprint) {
    next.blueprint = { ...(state.blueprint || {}), ...update.blueprint };
  }

  if (update.taskStatuses) {
    next.taskStatuses = { ...(state.taskStatuses || {}), ...update.taskStatuses };
  }

  if (update.fileRegistry) {
    const files = new Map((state.fileRegistry || []).map((file) => [file.path, file]));
    for (const file of update.fileRegistry) {
      files.set(file.path, file);
    }
    next.fileRegistry = Array.from(files.values());
  }

  if (update.pmConversation) {
    next.pmConversation = [
      ...(state.pmConversation || []),
      ...update.pmConversation,
    ];
  }

  return next;
}

function waitForHumanInput(project, request) {
  emit(project, {
    type: "human_input_needed",
    ...request,
  });

  return new Promise((resolve, reject) => {
    project.waitingForHumanInput = { resolve, reject };
  });
}

function handleClientMessage(project, message) {
  if (message.type === "cancel") {
    project.cancelled = true;
    project.status = "cancelled";
    emit(project, { type: "run_cancelled" });
    return;
  }

  if (message.type === "human_response") {
    resolveHumanInput(project, message.data || {});
  }
}

function resolveHumanInput(project, data) {
  if (!project.waitingForHumanInput) {
    return false;
  }

  const waiting = project.waitingForHumanInput;
  project.waitingForHumanInput = null;
  waiting.resolve(data);
  return true;
}

function throwIfCancelled(project) {
  if (project.cancelled) {
    throw new Error("Project was cancelled");
  }
}

function failProject(project, error) {
  project.status = "error";
  emit(project, {
    type: "error",
    message: error.message,
    recoverable: false,
  });
}

function buildFinalState(project) {
  const state = project.state || {};
  const frontendUrl = state.appUrls?.frontendUrl || "";

  return {
    status: "complete",
    frontendUrl,
    appUrls: frontendUrl ? { frontendUrl } : null,
  };
}

function projectSummary(project) {
  return {
    projectId: project.id,
    requirement: project.requirement,
    status: project.status,
    sandboxId: project.state?.sandboxId || "",
    sandboxPath: getProjectSandboxPath(project),
    events: project.events,
    state: project.state,
  };
}

function getProjectSandboxPath(project) {
  try {
    return project.state?.sandboxId ? getSandboxPath(project.state.sandboxId) : "";
  } catch {
    return "";
  }
}

function emit(project, event) {
  const message = {
    timestamp: Date.now(),
    projectId: project.id,
    ...event,
  };

  project.events.push(message);

  for (const client of project.clients) {
    sendWebSocketJson(client, message);
  }
}

function handleWebSocketUpgrade(req, socket) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const project = projects.get(url.searchParams.get("projectId"));
  if (!project) {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  const acceptKey = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${acceptKey}`,
    "",
    "",
  ].join("\r\n"));

  project.clients.add(socket);

  socket.on("data", (buffer) => {
    for (const message of decodeWebSocketMessages(buffer)) {
      try {
        handleClientMessage(project, JSON.parse(message));
      } catch {
        sendWebSocketJson(socket, { type: "error", message: "Invalid WebSocket message" });
      }
    }
  });

  socket.on("close", () => project.clients.delete(socket));
  socket.on("error", () => project.clients.delete(socket));

  sendWebSocketJson(socket, {
    type: "status",
    projectId: project.id,
    status: project.status,
    timestamp: Date.now(),
  });
  for (const event of project.events) {
    sendWebSocketJson(socket, event);
  }
}

function sendWebSocketJson(socket, data) {
  if (socket.destroyed) {
    return;
  }

  socket.write(encodeWebSocketMessage(JSON.stringify(data)));
}

function encodeWebSocketMessage(message) {
  const payload = Buffer.from(message);
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function decodeWebSocketMessages(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset] & 0x0f;
    let length = buffer[offset + 1] & 0x7f;
    const masked = Boolean(buffer[offset + 1] & 0x80);
    offset += 2;

    if (opcode === 0x8) {
      return messages;
    }

    if (length === 126) {
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      length = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    const mask = masked ? buffer.slice(offset, offset + 4) : null;
    if (masked) {
      offset += 4;
    }

    const payload = buffer.slice(offset, offset + length);
    offset += length;

    if (masked) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    messages.push(payload.toString("utf8"));
  }

  return messages;
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, data) {
  const body = statusCode === 204 ? "" : JSON.stringify(data);

  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

function serveStaticFile(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(frontendDist, requestedPath));

  if (!filePath.startsWith(frontendDist)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { "Content-Type": getContentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (fs.existsSync(frontendIndex)) {
    res.writeHead(200, { "Content-Type": "text/html" });
    fs.createReadStream(frontendIndex).pipe(res);
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`
    <html>
      <body style="font-family: sans-serif; padding: 32px">
        <h1>AI Team Dashboard</h1>
        <p>Frontend build not found. Run <code>npm run build</code> before starting the server.</p>
      </body>
    </html>
  `);
}

function getContentType(filePath) {
  const extension = path.extname(filePath);

  return {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
  }[extension] || "application/octet-stream";
}
