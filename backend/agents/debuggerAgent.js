import { safeCallGeminiWithRetry } from "../utils/gemini.js";
import { getFileList, readFile, rollback } from "../utils/sandboxManager.js";

const MAX_ATTEMPTS_BEFORE_CONTEXT_EXPAND = 2;
const MAX_ATTEMPTS_BEFORE_ROLLBACK = 4;

const DEBUGGER_PROMPT = `
You are the Debugger Agent.

Find the real cause of the sandbox failure and return a small repair plan for the coder.

Return only JSON:
{
  "rootCause": "Exact problem",
  "fix": "Smallest code change needed",
  "affectedFiles": ["backend/src/index.js"],
  "confidence": "high | medium | low"
}

Rules:
- Use only the error, task, blueprint context, registry context, and file contents provided.
- Keep affectedFiles project-relative and limited to files the coder should edit.
- If a frontend .js file contains JSX, fix that file or move JSX to a .jsx file.
- If an import cannot resolve, include both the importing file and the missing target file when it is project code.
- If npm install/build/test/start fails, point to the generated file that caused it, not package internals.
- Be specific. Do not suggest broad rewrites.
`;

const DEFAULT_DEBUG_STATE = {
  attempts: 0,
  rollbackAttempted: false,
  rollbackContext: null,
};

export async function debuggerAgentNode(state) {
  const debugState = {
    ...DEFAULT_DEBUG_STATE,
    ...(state.debugState || {}),
  };

  const attempts = debugState.attempts + 1;
  console.log(`\n[Debugger] Attempt ${attempts}\n`);

  if (shouldRollback(debugState)) {
    const rollbackUpdate = rollbackToLastGoodSnapshot(state, debugState);
    if (rollbackUpdate) return rollbackUpdate;
  }

  const errors = state.executionResult?.errors || "Unknown execution error";
  const affectedFiles = affectedFilesForFailure({
    currentTask: state.currentTask,
    errors,
  });
  const fileContext = readFailureContext({
    sandboxId: state.sandboxId,
    affectedFiles,
    includeRelatedFiles: attempts > MAX_ATTEMPTS_BEFORE_CONTEXT_EXPAND,
  });

  const result = await safeCallGeminiWithRetry({
    systemPrompt: DEBUGGER_PROMPT,
    userPrompt: buildDebuggerPrompt({
      state,
      errors,
      affectedFiles,
      fileContext,
    }),
    agentName: "debuggerAgent",
  });

  if (!result.ok) {
    return {
      reviewResult: {
        verdict: "rejected",
        issues: [errors],
        reviewCycle: 0,
      },
      debugState: {
        ...debugState,
        attempts,
      },
    };
  }

  const debugResult = normalizeDebugResult(result.parsed);
  const retryFiles = retryFilesFor({
    currentTask: state.currentTask,
    debugResult,
    errors,
  });

  console.log(`Root cause: ${debugResult.rootCause}`);
  console.log(`Fix: ${debugResult.fix}`);

  return {
    currentTask: state.currentTask
      ? {
        ...state.currentTask,
        filesToCreate: retryFiles,
      }
      : state.currentTask,

    reviewResult: {
      verdict: "rejected",
      issues: [debugResult.rootCause, debugResult.fix].filter(Boolean),
      reviewCycle: 0,
    },

    debugState: {
      ...debugState,
      attempts,
    },
  };
}

function shouldRollback(debugState) {
  return debugState.attempts >= MAX_ATTEMPTS_BEFORE_ROLLBACK &&
    !debugState.rollbackAttempted;
}

function rollbackToLastGoodSnapshot(state, debugState) {
  const doneCount = Object.values(state.taskStatuses || {})
    .filter((status) => status === "done")
    .length;

  if (!doneCount || !state.sandboxId) {
    return null;
  }

  const tag = `v0.${doneCount}.0`;
  const result = rollback(state.sandboxId, tag);

  if (!result.success) {
    return {
      debugState: {
        ...debugState,
        rollbackAttempted: true,
        rollbackContext: {
          failedRollbackTo: tag,
          error: result.error || "rollback failed",
        },
      },
    };
  }

  console.log(`[Debugger] Rolled back to ${tag}`);

  return {
    debugState: {
      attempts: 0,
      rollbackAttempted: true,
      rollbackContext: {
        rolledBackTo: tag,
        restoredCompletedTaskCount: doneCount,
        failedTaskId: state.currentTask?.taskId || "",
        failedTaskTitle: state.currentTask?.title || "",
        note: "Sandbox restored to last passing snapshot. Retry the current task with existing interfaces preserved.",
      },
    },
    reviewResult: { verdict: "", issues: [], reviewCycle: 0 },
    executionResult: { result: "", output: "", errors: "" },
  };
}

function buildDebuggerPrompt({
  state,
  errors,
  affectedFiles,
  fileContext,
}) {
  return [
    "ERROR:",
    errors,
    "CURRENT TASK:",
    JSON.stringify({
      taskId: state.currentTask?.taskId || "",
      phaseName: state.currentTask?.phaseName || "",
      title: state.currentTask?.title || "",
      description: state.currentTask?.description || "",
      filesToCreate: state.currentTask?.filesToCreate || [],
      filesNeeded: state.currentTask?.filesNeeded || [],
    }, null, 2),
    "BLUEPRINT CONTEXT:",
    JSON.stringify({
      entities: state.contextPackage?.relevantEntities || state.blueprint?.entities || [],
      tables: state.contextPackage?.relevantTables || state.blueprint?.dbSchema?.tables || [],
      apiEndpoints: state.contextPackage?.apiEndpoints || state.blueprint?.apiEndpoints || [],
      frontendPages: state.contextPackage?.relevantFrontendPages || state.blueprint?.frontendPages || [],
    }, null, 2),
    "REGISTRY CONTEXT:",
    JSON.stringify(state.contextPackage?.existingFileInterfaces || {}, null, 2),
    "FILES LIKELY TO FIX:",
    affectedFiles.join(", ") || "unknown",
    "FILE CONTENTS:",
    fileContext || "No readable file context.",
  ].join("\n\n");
}

function affectedFilesForFailure({ currentTask, errors }) {
  return uniqueProjectFiles([
    ...(currentTask?.filesToCreate || []),
    ...filesFromErrorText(errors),
  ]);
}

function retryFilesFor({ currentTask, debugResult, errors }) {
  return uniqueProjectFiles([
    ...(currentTask?.filesToCreate || []),
    ...(debugResult.affectedFiles || []),
    ...filesFromErrorText(errors),
  ]);
}

function filesFromErrorText(errors = "") {
  const message = String(errors);
  const files = [];

  collectPathMatches(files, message);
  collectViteImportMatches(files, message);

  if (/package\.json|npm install|Cannot find package/i.test(message)) {
    files.push("backend/package.json", "frontend/package.json");
  }

  return files;
}

function collectPathMatches(files, message) {
  const pathPattern = /(?:\/app\/)?((?:backend|frontend)\/[^\s:'")]+?\.(?:js|jsx|css|html|json))/g;
  let match;

  while ((match = pathPattern.exec(message))) {
    files.push(cleanProjectPath(match[1]));
  }

  const srcPattern = /\b(src\/[^\s:'")]+?\.(?:js|jsx|css|html|json))/g;
  while ((match = srcPattern.exec(message))) {
    files.push(inferProjectRoot(match[1], message));
  }
}

function collectViteImportMatches(files, message) {
  const importPattern = /(?:Could not resolve|failed to resolve import)\s+"([^"]+)"\s+from\s+"([^"]+)"/gi;
  let match;

  while ((match = importPattern.exec(message))) {
    const sourceFile = normalizeVitePath(match[2]);
    if (sourceFile) files.push(sourceFile);

    const targetFile = resolveRelativeImport(sourceFile, match[1]);
    if (targetFile) files.push(targetFile);
  }
}

function readFailureContext({ sandboxId, affectedFiles, includeRelatedFiles }) {
  const files = includeRelatedFiles
    ? uniqueProjectFiles([...affectedFiles, ...relatedJsFiles(sandboxId, affectedFiles)])
    : affectedFiles;

  return files
    .map((filePath) => readContextFile(sandboxId, filePath))
    .filter(Boolean)
    .join("\n\n");
}

function relatedJsFiles(sandboxId, affectedFiles) {
  try {
    return getFileList(sandboxId)
      .filter((filePath) => /\.(js|jsx)$/.test(filePath))
      .filter((filePath) => !filePath.includes("node_modules"))
      .filter((filePath) => !affectedFiles.includes(filePath))
      .slice(0, 8);
  } catch {
    return [];
  }
}

function readContextFile(sandboxId, filePath) {
  try {
    const content = readFile(sandboxId, filePath);
    if (!content) return "";

    const shortContent = content.split("\n").slice(0, 220).join("\n");
    return `--- ${filePath} ---\n${shortContent}`;
  } catch {
    return "";
  }
}

function normalizeDebugResult(parsed = {}) {
  return {
    rootCause: String(parsed.rootCause || "Execution failed.").trim(),
    fix: String(parsed.fix || "Repair the affected generated files.").trim(),
    affectedFiles: uniqueProjectFiles(parsed.affectedFiles || []),
    confidence: ["high", "medium", "low"].includes(parsed.confidence)
      ? parsed.confidence
      : "medium",
  };
}

function uniqueProjectFiles(filePaths) {
  return Array.from(new Set(
    (Array.isArray(filePaths) ? filePaths : [])
      .map(cleanProjectPath)
      .filter((filePath) =>
        filePath.startsWith("backend/") ||
        filePath.startsWith("frontend/")
      )
  ));
}

function cleanProjectPath(filePath) {
  return String(filePath || "")
    .trim()
    .replace(/^\/app\//, "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
}

function inferProjectRoot(srcPath, message) {
  const path = cleanProjectPath(srcPath);

  if (!path.startsWith("src/")) {
    return path;
  }

  if (/backend/i.test(message) || /^src\/(?:models|controllers|routes|config|middleware)\//.test(path)) {
    return `backend/${path}`;
  }

  return `frontend/${path}`;
}

function normalizeVitePath(filePath) {
  const path = cleanProjectPath(filePath);

  if (path.startsWith("backend/") || path.startsWith("frontend/")) {
    return path;
  }

  if (path.startsWith("src/")) {
    return `frontend/${path}`;
  }

  return "";
}

function resolveRelativeImport(sourceFile, importPath) {
  if (!sourceFile || !importPath.startsWith(".")) {
    return "";
  }

  const sourceParts = sourceFile.split("/").slice(0, -1);
  const parts = [...sourceParts, ...importPath.split("/")];
  const resolved = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  const path = resolved.join("/");
  return /\.(js|jsx|json|css)$/.test(path) ? path : `${path}.js`;
}

export function debuggerRouter() {
  return "contextBuilder";
}
