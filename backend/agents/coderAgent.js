import { safeCallGeminiWithRetry } from "../utils/gemini.js";
import { readFile, writeFile } from "../utils/sandboxManager.js";

const BASE_RULES = `
Return only JSON:
{
  "path": "project-relative path",
  "content": "complete file content",
  "notes": "short note"
}

Rules:
- Write exactly one file: the requested FILE TO WRITE.
- Use the task, blueprint, registry, dependencies, and conventions as the contract.
- Do not invent files, APIs, entities, tables, imports, or dependencies.
- Write complete runnable code. No TODO-only placeholders.
- Import only files listed in EXISTING FILES TO IMPORT FROM, or files in the same task when the task asks for them.
- Keep secrets out of generated files.
`;

const BACKEND_PROMPT = `
You are a backend engineer writing one Node/Express project file.

${BASE_RULES}
- Use ES modules and include .js on local backend imports.
- Use process.env for backend env vars.
- Use parameterized SQL when writing database queries.
- API responses use { success: true, data: ... } or { success: false, message: string }.
- backend/package.json start/dev scripts must run src/index.js.
`;

const FRONTEND_PROMPT = `
You are a frontend engineer writing one React/Vite project file.

${BASE_RULES}
- Use functional React components and hooks.
- Use Tailwind classes, not inline styles.
- JSX belongs in .jsx files only.
- Frontend env vars use import.meta.env.
- API clients should use import.meta.env.VITE_API_BASE_URL || '/api/v1'.
- If writing vite.config.js, read proxy target from process.env.VITE_API_BASE_URL when a proxy is needed.
- Use the exact backend API paths and response shape from the context.
- Include loading, error, and empty states for async UI.
`;

const GENERAL_PROMPT = `
You are a full-stack engineer writing one project file.

${BASE_RULES}
- Use ES modules for JS/JSX files.
- package.json files must include scripts and dependencies from the dependency contract.
`;

export async function coderAgentNode(state) {
  const { currentTask, contextPackage, sandboxId } = state;

  if (!currentTask || !contextPackage) {
    return { coderOutput: null };
  }

  const files = asList(contextPackage.task?.filesToCreate);
  const results = [];

  for (const filePath of files) {
    results.push(await writeOneFile({ state, sandboxId, filePath, contextPackage }));
  }

  const passed = results.filter((file) => !file.error).length;

  return {
    coderOutput: {
      files: results,
      notes: `${passed} files written, ${results.length - passed} failed`,
      error: files.length > 0 && passed === 0,
      taskId: currentTask.taskId || "",
      phaseName: currentTask.phaseName || "",
    },
  };
}

async function writeOneFile({ state, sandboxId, filePath, contextPackage }) {
  const pathError = validatePath(filePath, contextPackage);
  if (pathError) return failedFile(filePath, pathError);

  const result = await safeCallGeminiWithRetry({
    systemPrompt: promptFor(filePath),
    userPrompt: buildPrompt({ state, filePath, sandboxId, contextPackage }),
    agentName: "coderAgent",
  });

  if (!result.ok) return failedFile(filePath, result.error);

  const file = pickFile(result.parsed, filePath);
  const content = String(file.content || "");
  if (!content.trim()) return failedFile(filePath, "Empty content");

  try {
    writeFile(sandboxId, filePath, content);
    return {
      path: filePath,
      lines: content.split("\n").length,
      notes: file.notes || "",
      modelPath: file.path || "",
      pathCorrected: Boolean(file.path && file.path !== filePath),
      fileKind: fileKind(filePath),
    };
  } catch (error) {
    return failedFile(filePath, error.message);
  }
}

function buildPrompt({ state, filePath, sandboxId, contextPackage }) {
  return [
    `FILE TO WRITE: ${filePath}`,
    `FILE KIND: ${fileKind(filePath)}`,
    phaseRules(contextPackage),
    section("TASK", contextPackage.task),
    section("FILE CONTRACT", contextPackage.fileContract),
    section("APP", contextPackage.app),
    section("AUTH", contextPackage.auth),
    section("DEPENDENCIES", contextPackage.dependencies),
    section("NAMING MAP", contextPackage.namingMap),
    section("EXISTING FILES TO IMPORT FROM", dependencyContext(filePath, contextPackage)),
    section("COMPLETED FILES", contextPackage.completedFileRegistry || contextPackage.completedFiles),
    section("BLUEPRINT CONTEXT", {
      entities: contextPackage.relevantEntities,
      tables: contextPackage.relevantTables,
      apiEndpoints: contextPackage.apiEndpoints || contextPackage.relevantApiEndpoints,
      frontendPages: contextPackage.relevantFrontendPages,
      sharedComponents: contextPackage.sharedComponents,
      folderStructure: contextPackage.folderStructure,
    }),
    section("DATABASE SCHEMA", contextPackage.dbSchema),
    section("API RESPONSE CONTRACT", contextPackage.apiResponseContract),
    section("CONVENTIONS", contextPackage.conventions),
    retryContext({ state, sandboxId, filePath }),
    `Return JSON for exactly "${filePath}". Do not return an array. Do not use markdown fences.`,
  ].filter(Boolean).join("\n\n");
}

function phaseRules(contextPackage) {
  const phase = contextPackage.task?.phaseName || contextPackage.currentPhase || "";

  if (phase === "setup") {
    return [
      "PHASE RULES:",
      "- Create base runnable files only.",
      "- backend/src/index.js should start Express and expose health/root routes, but should not import feature routes yet.",
      "- frontend/src/App.jsx should be a minimal shell, but should not import pages/components that are not created yet.",
      "- Feature wiring belongs to the integration phase.",
    ].join("\n");
  }

  if (phase === "integration") {
    return [
      "PHASE RULES:",
      "- Wire already-created routes, pages, components, and providers together.",
      "- Do not add new feature files in entry files; import from the registry/context only.",
    ].join("\n");
  }

  return "";
}

function dependencyContext(currentFilePath, contextPackage) {
  const deps = contextPackage.existingFileInterfaces || contextPackage.dependencyInterfaces || {};

  return Object.fromEntries(
    Object.entries(deps).map(([path, info]) => [
      path,
      {
        suggestedImport: suggestedImport(currentFilePath, path, info),
        fileKind: info.fileKind || "",
        defaultExport: info.defaultExport || null,
        namedExports: info.namedExports || [],
        exports: info.exports || [],
        interface: info.interface || "",
        apiRoutes: info.apiRoutes || [],
        apiCalls: info.apiCalls || [],
        dbTables: info.dbTables || [],
        dbOperations: info.dbOperations || [],
        responseShape: info.responseShape || "",
      },
    ])
  );
}

function retryContext({ state, sandboxId, filePath }) {
  const issues = state.reviewResult?.issues || [];
  const errors = state.executionResult?.errors || "";
  const currentFile = readCurrentFile(sandboxId, filePath);
  const parts = [];

  if (issues.length) parts.push(section("REPAIR NOTES", issues));
  if (errors) parts.push(`EXECUTOR ERROR:\n${errors.slice(0, 1200)}`);
  if (currentFile) parts.push(`CURRENT FILE ON DISK:\n--- ${filePath} ---\n${currentFile}`);

  return parts.join("\n\n");
}

function promptFor(filePath) {
  if (filePath.startsWith("backend/")) return BACKEND_PROMPT;
  if (filePath.startsWith("frontend/")) return FRONTEND_PROMPT;
  return GENERAL_PROMPT;
}

function validatePath(filePath, contextPackage) {
  const allowed = new Set(contextPackage.fileContract?.filesToCreate || contextPackage.task?.filesToCreate || []);

  if (!filePath) return "Missing file path";
  if (filePath.startsWith("/") || filePath.includes("..")) return `Unsafe path: ${filePath}`;
  if (!allowed.has(filePath)) return `${filePath} is not in task.filesToCreate`;
  if (filePath === ".gitignore" || filePath === "README.md") return "";
  if (filePath.startsWith("backend/") || filePath.startsWith("frontend/")) return "";

  return `${filePath} is outside the generated project roots`;
}

function pickFile(parsed, requestedPath) {
  const files = Array.isArray(parsed?.files)
    ? parsed.files
    : Array.isArray(parsed)
      ? parsed
      : [parsed || {}];

  return files.find((file) => file?.path === requestedPath) || files[0] || {};
}

function suggestedImport(fromFile, toFile, info = {}) {
  if (!/\.(js|jsx)$/.test(toFile)) return "";

  const source = relativeImport(fromFile, toFile);
  const defaultExport = info.defaultExport || "";
  const namedExports = info.namedExports?.length
    ? info.namedExports
    : (info.exports || []).filter((name) => name && name !== defaultExport);

  if (defaultExport && namedExports.length) {
    return `import ${defaultExport}, { ${namedExports.join(", ")} } from '${source}';`;
  }
  if (defaultExport) return `import ${defaultExport} from '${source}';`;
  if (namedExports.length) return `import { ${namedExports.join(", ")} } from '${source}';`;

  return `import '${source}';`;
}

function relativeImport(fromFile, toFile) {
  const from = fromFile.split("/").slice(0, -1);
  const to = toFile.split("/");
  let same = 0;

  while (from[same] && from[same] === to[same]) same += 1;

  const path = [
    ...from.slice(same).map(() => ".."),
    ...to.slice(same),
  ].join("/");

  return path.startsWith(".") ? path : `./${path}`;
}

function fileKind(filePath) {
  if (filePath.endsWith("package.json")) return "package";
  if (filePath.endsWith(".env.example")) return "env";
  if (filePath.includes("/models/")) return "backend model";
  if (filePath.includes("/controllers/")) return "backend controller";
  if (filePath.includes("/routes/")) return "backend route";
  if (filePath.includes("/middleware/")) return "backend middleware";
  if (filePath.includes("/pages/")) return "frontend page";
  if (filePath.includes("/components/")) return "frontend component";
  if (filePath.includes("/context/")) return "frontend context";
  if (filePath.includes("/utils/")) return "utility";
  if (filePath.endsWith(".jsx")) return "jsx";
  if (filePath.endsWith(".js")) return "js";
  return "project file";
}

function readCurrentFile(sandboxId, filePath) {
  try {
    return sandboxId ? readFile(sandboxId, filePath) || "" : "";
  } catch {
    return "";
  }
}

function section(title, value) {
  if (value == null) return "";
  if (Array.isArray(value) && value.length === 0) return "";
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return "";

  return `${title}:\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`;
}

function asList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function failedFile(path, error) {
  return {
    path,
    lines: 0,
    error,
  };
}
