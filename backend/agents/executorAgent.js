import { executeCommand, readFile } from "../utils/sandboxManager.js";

const INSTALL_TIMEOUT = 120000;
const CHECK_TIMEOUT = 60000;
const START_TIMEOUT = 12000;

export function executorAgentNode(state) {
  console.log("\n[Executor] Running sandbox checks\n");

  const { currentTask, coderOutput, sandboxId } = state;

  if (!currentTask || !sandboxId) {
    return pass("No active sandbox task to execute.");
  }

  const files = successfulFiles(coderOutput);
  if (files.length === 0) {
    return fail("Coder did not write any files for this task.");
  }

  const steps = buildSteps({ files, sandboxId, currentTask });
  if (steps.length === 0) {
    return pass("No runnable package is ready for this task yet.");
  }

  const output = [];

  for (const step of steps) {
    console.log(`   ${step.label}`);

    const result = executeCommand(sandboxId, step.command, step.timeout);
    const text = commandText(result);

    output.push(formatStep(step.label, text || "ok"));

    if (result.exitCode !== 0 && !step.allowExitCodes.includes(result.exitCode)) {
      return fail(formatStep(step.label, text || `exit code ${result.exitCode}`), output);
    }
  }

  return pass(output.join("\n\n"));
}

function successfulFiles(coderOutput = {}) {
  return (coderOutput.files || [])
    .filter((file) => file?.path && !file.error)
    .map((file) => file.path);
}

function buildSteps({ files, sandboxId, currentTask }) {
  const steps = [];

  if (files.some((file) => file.startsWith("backend/"))) {
    steps.push(...backendSteps(sandboxId, files, currentTask));
  }

  if (files.some((file) => file.startsWith("frontend/"))) {
    steps.push(...frontendSteps(sandboxId, files));
  }

  return steps;
}

function backendSteps(sandboxId, files, currentTask) {
  if (!hasFile(sandboxId, "backend/package.json")) {
    return [];
  }

  const steps = [
    step("backend install", "backend", "npm install", INSTALL_TIMEOUT),
    step("backend build", "backend", "npm run build --if-present", CHECK_TIMEOUT),
    step("backend test", "backend", "npm test --if-present", CHECK_TIMEOUT),
  ];

  if (shouldStartBackend(sandboxId, currentTask)) {
    steps.push(step("backend start", "backend", "timeout 8s npm start", START_TIMEOUT, [124]));
  }

  return steps;
}

function shouldStartBackend(sandboxId, currentTask = {}) {
  const phase = currentTask.phaseName || "";
  const files = currentTask.filesToCreate || [];

  return hasBackendEntry(sandboxId) &&
    ["integration", "documentation"].includes(phase) &&
    files.includes("backend/src/index.js");
}

function frontendSteps(sandboxId, files) {
  if (!hasFile(sandboxId, "frontend/package.json")) {
    return [];
  }

  const steps = [
    step("frontend install", "frontend", "npm install", INSTALL_TIMEOUT),
  ];

  if (hasFrontendEntry(sandboxId)) {
    steps.push(
      step("frontend build", "frontend", "npm run build --if-present", CHECK_TIMEOUT),
      step("frontend test", "frontend", "npm test --if-present", CHECK_TIMEOUT)
    );
  }

  return steps;
}

function hasBackendEntry(sandboxId) {
  return hasFile(sandboxId, "backend/src/index.js");
}

function hasFrontendEntry(sandboxId) {
  return [
    "frontend/index.html",
    "frontend/src/main.jsx",
    "frontend/src/App.jsx",
  ].every((file) => hasFile(sandboxId, file));
}

function hasFile(sandboxId, filePath) {
  try {
    return Boolean(readFile(sandboxId, filePath));
  } catch {
    return false;
  }
}

function step(label, folder, script, timeout, allowExitCodes = []) {
  return {
    label,
    command: `if [ -d /app/${folder} ]; then cd /app/${folder}; else cd ${folder}; fi; ${script}`,
    timeout,
    allowExitCodes,
  };
}

function commandText(result) {
  return [result.stdout, result.stderr]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
}

function formatStep(label, text) {
  const trimmed = String(text || "").trim();
  const short = trimmed.length > 1600 ? `${trimmed.slice(0, 1600)}...` : trimmed;
  return `${label}:\n${short}`;
}

function pass(output) {
  console.log("PASSED");

  return {
    executionResult: {
      result: "pass",
      output,
      errors: "",
    },
  };
}

function fail(error, output = []) {
  console.log("FAILED");
  console.log(error);

  return {
    executionResult: {
      result: "fail",
      output: output.join("\n\n"),
      errors: error,
    },
  };
}

export function executorRouter(state) {
  return state.executionResult?.result === "pass"
    ? "snapshotManager"
    : "debuggerAgent";
}
