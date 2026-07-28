import { safeCallGeminiWithRetry } from "../utils/gemini.js";
import { readFile } from "../utils/sandboxManager.js";

const REGISTRY_PROMPT = `You are the File Interface Registry Agent.

GOAL:
Analyze generated project files and record the public contract future coder tasks need.

For each file, extract:
- file kind: package, backend-model, backend-controller, backend-route, backend-middleware, backend-config, frontend-page, frontend-component, frontend-context, utility, css, html, documentation, or project-file
- default export and named exports
- imports, including local file imports and package imports
- exact import statement another generated file should use when importing this file
- functions, classes, React components, middleware, route handlers, and utilities
- Express API routes created by this file, including method, path, handler, auth middleware, and response shape
- frontend API calls made by this file, including method, path, helper used, and response data path read
- database tables/models used and operations performed
- whether DB writes use model functions or parameterized queries instead of raw unsafe concatenation
- environment variables and package dependencies referenced
- side effects such as starting a server, registering middleware, mounting routes, creating context providers, or configuring axios
- a concise but useful interface summary

OUTPUT FORMAT (strict JSON):
{
  "files": [
    {
      "path": "backend/src/config/db.js",
      "fileKind": "backend-config",
      "defaultExport": null,
      "namedExports": ["pool", "connectDB"],
      "imports": ["pg", "dotenv"],
      "localImports": [],
      "packageImports": ["pg", "dotenv"],
      "importStatement": "import { pool, connectDB } from '../config/db.js'",
      "functions": [
        { "name": "connectDB", "kind": "async function", "params": [], "returns": "Promise<void>" }
      ],
      "components": [],
      "apiRoutes": [
        { "method": "GET", "path": "/api/v1/tasks", "handler": "getTasks", "requiresAuth": true, "responseShape": "{ success, data }" }
      ],
      "apiCalls": [
        { "method": "GET", "path": "/api/v1/tasks", "caller": "loadTasks", "responseDataPath": "response.data.data" }
      ],
      "dbTables": ["tasks"],
      "dbOperations": [
        { "table": "tasks", "operation": "select", "functionName": "getTasks", "safeQuery": true }
      ],
      "envVars": ["DATABASE_URL"],
      "dependencies": ["pg"],
      "sideEffects": ["creates pg Pool"],
      "responseShape": "{ success: true, data: ... }",
      "dataPersistence": "Persists tasks through INSERT/UPDATE/DELETE model functions using parameterized queries.",
      "conventionsFollowed": ["ES modules", "parameterized SQL"],
      "warnings": [],
      "interface": "pool: pg Pool instance. connectDB(): async, tests connection."
    }
  ]
}

RULES:
- importStatement must be valid ES module syntax.
- Use relative paths in importStatement.
- List all public exports.
- Mark functions as async or sync when clear.
- Include empty arrays for categories that do not apply.
- Do not invent API routes, DB operations, response fields, imports, or exports. If it is not present in code, leave it empty.
- Prefer exact method/path strings from the file source.
- For backend controllers, record the JSON response envelope and where data is placed.
- For frontend files, record the exact backend API path called and the response.data path read.
- If a file has no public exports, still describe side effects and runtime contract in interface.`;

export async function updateRegistryNode(state) {
  
  console.log("\n[Update Registry] Indexing new files\n");

  const { blueprint, coderOutput, currentTask, sandboxId } = state;

  if (!coderOutput?.files?.length) {
    console.log("   No files to index");
    return {};
  }

  const fileContents = [];

  for (const file of coderOutput.files) {
    
    if (file.error) continue;
    try {
      const content = readFile(sandboxId, file.path);
      if (content) fileContents.push({ path: file.path, content });
    } catch (error) {
      console.warn(`   Could not read ${file.path}: ${error.message}`);
    }
  }

  if (fileContents.length === 0) {
    console.log("   No file contents to analyze");
    return {};
  }

  const userPrompt = buildRegistryPrompt({
    blueprint,
    coderOutput,
    currentTask,
    fileContents,
  });

  const result = await safeCallGeminiWithRetry({
    systemPrompt: REGISTRY_PROMPT,
    userPrompt,
    agentName: "updateRegistry",
  });

  if (!result.ok) {
    console.error(`   updateRegistry failed: ${result.error}. Falling back to deterministic indexing.`);
  }

  const registryEntries = buildRegistryEntries({
    modelEntries: result.ok ? result.parsed?.files || [] : [],
    fileContents,
    blueprint,
    currentTask,
    coderOutput,
    registryError: result.ok ? "" : result.error,
  });

  console.log(`   Indexed ${registryEntries.length} files:`);
  for (const file of registryEntries) {
    console.log(`   ${file.path} -> ${file.importStatement || "no import info"}`);
  }

  return {
    fileRegistry: registryEntries.map((file) => ({
      path: file.path,
      fileKind: file.fileKind || inferFileKind(file.path),
      defaultExport: file.defaultExport || null,
      namedExports: file.namedExports || [],
      exports: [...(file.namedExports || []), ...(file.defaultExport ? [file.defaultExport] : [])],
      imports: normalizeStringList(file.imports),
      localImports: normalizeStringList(file.localImports),
      packageImports: normalizeStringList(file.packageImports),
      importStatement: file.importStatement || "",
      functions: normalizeObjectList(file.functions),
      components: normalizeObjectList(file.components),
      apiRoutes: normalizeObjectList(file.apiRoutes),
      apiCalls: normalizeObjectList(file.apiCalls),
      dbTables: normalizeStringList(file.dbTables),
      dbOperations: normalizeObjectList(file.dbOperations),
      envVars: normalizeStringList(file.envVars),
      dependencies: normalizeStringList(file.dependencies),
      sideEffects: normalizeStringList(file.sideEffects),
      responseShape: file.responseShape || "",
      dataPersistence: file.dataPersistence || "",
      conventionsFollowed: normalizeStringList(file.conventionsFollowed),
      warnings: normalizeStringList(file.warnings),
      source: file.source || "model",
      interface: file.interface || "",
      taskId: currentTask?.taskId || "",
      phaseName: currentTask?.phaseName || "",
      coderNotes: findCoderNotes(coderOutput, file.path),
      updatedAt: Date.now(),
    })),
  };
}

function buildRegistryEntries({
  modelEntries = [],
  fileContents = [],
  blueprint = {},
  currentTask = {},
  coderOutput = {},
  registryError = "",
}) {
  const modelByPath = new Map(
    (Array.isArray(modelEntries) ? modelEntries : [])
      .filter((entry) => entry?.path)
      .map((entry) => [normalizeProjectPath(entry.path), entry])
  );

  return fileContents.map((file) => {
    const normalizedPath = normalizeProjectPath(file.path);
    const modelEntry = modelByPath.get(normalizedPath) || {};
    const fallbackEntry = buildFallbackRegistryEntry({
      path: normalizedPath,
      content: file.content,
      blueprint,
      currentTask,
      coderOutput,
      registryError,
    });

    return mergeRegistryEntry(fallbackEntry, modelEntry, normalizedPath);
  });
}

function mergeRegistryEntry(fallbackEntry, modelEntry, filePath) {
  const namedExports = mergeUniqueStrings(
    fallbackEntry.namedExports,
    modelEntry.namedExports
  );
  const defaultExport = modelEntry.defaultExport || fallbackEntry.defaultExport || null;
  const imports = mergeUniqueStrings(fallbackEntry.imports, modelEntry.imports);
  const localImports = mergeUniqueStrings(fallbackEntry.localImports, modelEntry.localImports);
  const packageImports = mergeUniqueStrings(fallbackEntry.packageImports, modelEntry.packageImports);
  const apiRoutes = mergeObjects(fallbackEntry.apiRoutes, modelEntry.apiRoutes, routeKey);
  const apiCalls = mergeObjects(fallbackEntry.apiCalls, modelEntry.apiCalls, callKey);
  const dbOperations = mergeObjects(fallbackEntry.dbOperations, modelEntry.dbOperations, dbOperationKey);
  const dbTables = mergeUniqueStrings(fallbackEntry.dbTables, modelEntry.dbTables);

  return {
    ...fallbackEntry,
    ...modelEntry,
    path: filePath,
    fileKind: modelEntry.fileKind || fallbackEntry.fileKind,
    defaultExport,
    namedExports,
    imports,
    localImports,
    packageImports,
    importStatement: modelEntry.importStatement || buildImportStatement(filePath, namedExports, defaultExport),
    functions: mergeObjects(fallbackEntry.functions, modelEntry.functions, (item) => item.name || JSON.stringify(item)),
    components: mergeObjects(fallbackEntry.components, modelEntry.components, (item) => item.name || JSON.stringify(item)),
    apiRoutes,
    apiCalls,
    dbTables,
    dbOperations,
    envVars: mergeUniqueStrings(fallbackEntry.envVars, modelEntry.envVars),
    dependencies: mergeUniqueStrings(fallbackEntry.dependencies, modelEntry.dependencies || packageImports),
    sideEffects: mergeUniqueStrings(fallbackEntry.sideEffects, modelEntry.sideEffects),
    conventionsFollowed: mergeUniqueStrings(fallbackEntry.conventionsFollowed, modelEntry.conventionsFollowed),
    warnings: mergeUniqueStrings(fallbackEntry.warnings, modelEntry.warnings),
    responseShape: modelEntry.responseShape || fallbackEntry.responseShape,
    dataPersistence: modelEntry.dataPersistence || fallbackEntry.dataPersistence,
    interface: modelEntry.interface || fallbackEntry.interface,
    source: modelEntry.path ? "model+fallback" : "fallback",
  };
}

function buildFallbackRegistryEntry({
  path,
  content,
  blueprint = {},
  currentTask = {},
  coderOutput = {},
  registryError = "",
}) {
  const defaultExport = extractDefaultExport(content);
  const namedExports = extractNamedExports(content);
  const imports = extractImports(content);
  const localImports = imports.filter((item) => item.startsWith(".") || item.startsWith("/"));
  const packageImports = imports.filter((item) => !item.startsWith(".") && !item.startsWith("/"));
  const functions = extractFunctions(content);
  const components = extractComponents({ path, content, functions, defaultExport, namedExports });
  const apiRoutes = extractApiRoutes(content);
  const apiCalls = extractApiCalls(content, blueprint.apiEndpoints || []);
  const dbTables = extractDbTables(content, blueprint);
  const dbOperations = extractDbOperations(content, dbTables);
  const envVars = extractEnvVars(content);
  const warnings = [];

  if (registryError) {
    warnings.push(`Registry model unavailable: ${registryError}`);
  }

  if (!namedExports.length && !defaultExport && isImportableFile(path)) {
    warnings.push("No public exports detected.");
  }

  return {
    path,
    fileKind: inferFileKind(path),
    defaultExport,
    namedExports,
    imports,
    localImports,
    packageImports,
    importStatement: buildImportStatement(path, namedExports, defaultExport),
    functions,
    components,
    apiRoutes,
    apiCalls,
    dbTables,
    dbOperations,
    envVars,
    dependencies: packageImports,
    sideEffects: extractSideEffects({ path, content }),
    responseShape: extractResponseShape(content),
    dataPersistence: buildDataPersistenceSummary({ path, dbOperations }),
    conventionsFollowed: extractConventions({ path, content }),
    warnings,
    interface: buildInterfaceSummary({
      path,
      defaultExport,
      namedExports,
      functions,
      components,
      apiRoutes,
      apiCalls,
      dbTables,
      currentTask,
      coderOutput,
    }),
    source: "fallback",
  };
}

function buildRegistryPrompt({
  blueprint,
  coderOutput,
  currentTask,
  fileContents,
}) {
  return [
    "CURRENT TASK:",
    JSON.stringify({
      taskId: currentTask?.taskId || "",
      phaseName: currentTask?.phaseName || "",
      title: currentTask?.title || "",
      filesToCreate: currentTask?.filesToCreate || [],
      filesNeeded: currentTask?.filesNeeded || [],
      acceptanceCriteria: currentTask?.acceptanceCriteria || [],
    }, null, 2),
    "CODER OUTPUT SUMMARY:",
    JSON.stringify({
      notes: coderOutput?.notes || "",
      files: (coderOutput?.files || []).map((file) => ({
        path: file.path,
        lines: file.lines,
        notes: file.notes || "",
        error: file.error || "",
      })),
    }, null, 2),
    "BLUEPRINT CONTRACT REFERENCE:",
    JSON.stringify(buildBlueprintRegistryReference(blueprint || {}), null, 2),
    "FILES TO INDEX:",
    fileContents
      .map((file) => `--- ${file.path} ---\n${file.content}\n`)
      .join("\n"),
  ].join("\n\n");
}

function buildBlueprintRegistryReference(blueprint = {}) {
  return {
    entities: (blueprint.entities || []).map((entity) => ({
      name: entity.name,
      tableName: entity.tableName,
      apiPath: entity.apiPath,
      modelFile: entity.modelFile,
      routeFile: entity.routeFile,
    })),
    tables: (blueprint.dbSchema?.tables || []).map((table) => ({
      name: table.name,
      fields: (table.fields || []).map((field) => field.name),
      foreignKeys: table.foreignKeys || [],
    })),
    apiEndpoints: (blueprint.apiEndpoints || []).map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      relatedTable: endpoint.relatedTable,
      requiresAuth: Boolean(endpoint.requiresAuth),
      responseBody: endpoint.responseBody || {},
    })),
    frontendPages: (blueprint.frontendPages || []).map((page) => ({
      name: page.name,
      route: page.route,
      requiresAuth: Boolean(page.requiresAuth),
      components: page.components || [],
    })),
  };
}

function normalizeProjectPath(filePath) {
  return String(filePath || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function inferFileKind(filePath) {
  if (filePath === "backend/package.json" || filePath === "frontend/package.json") return "package";
  if (filePath.endsWith(".env.example")) return "env-example";
  if (filePath.endsWith("README.md") || filePath === "README.md") return "documentation";
  if (filePath === ".gitignore") return "ignore";
  if (filePath.includes("/models/")) return "backend-model";
  if (filePath.includes("/controllers/")) return "backend-controller";
  if (filePath.includes("/routes/")) return "backend-route";
  if (filePath.includes("/middleware/")) return "backend-middleware";
  if (filePath.includes("/config/")) return "backend-config";
  if (filePath.includes("/pages/")) return "frontend-page";
  if (filePath.includes("/components/")) return "frontend-component";
  if (filePath.includes("/context/")) return "frontend-context";
  if (filePath.includes("/utils/")) return "utility";
  if (filePath.endsWith(".jsx")) return "react-jsx";
  if (filePath.endsWith(".js")) return "javascript";
  if (filePath.endsWith(".css")) return "css";
  if (filePath.endsWith(".html")) return "html";
  return "project-file";
}

function isImportableFile(filePath) {
  return /\.(js|jsx)$/.test(filePath);
}

function extractDefaultExport(content = "") {
  const namedDefault = content.match(/export\s+default\s+(?:function|class)?\s*([A-Za-z_$][\w$]*)/);
  if (namedDefault?.[1]) return namedDefault[1];

  const trailingDefault = content.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/);
  return trailingDefault?.[1] || null;
}

function extractNamedExports(content = "") {
  const exports = new Set();
  const declarationPattern = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  const groupedPattern = /export\s*\{([^}]+)\}/g;
  let match;

  while ((match = declarationPattern.exec(content))) {
    exports.add(match[1]);
  }

  while ((match = groupedPattern.exec(content))) {
    for (const part of match[1].split(",")) {
      const exportedName = part.trim().split(/\s+as\s+/i).pop()?.trim();
      if (exportedName) exports.add(exportedName);
    }
  }

  return Array.from(exports);
}

function extractImports(content = "") {
  const imports = new Set();
  const fromPattern = /import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  const sideEffectPattern = /import\s+["']([^"']+)["']/g;
  let match;

  while ((match = fromPattern.exec(content))) {
    imports.add(match[1]);
  }

  while ((match = sideEffectPattern.exec(content))) {
    imports.add(match[1]);
  }

  return Array.from(imports);
}

function extractFunctions(content = "") {
  const functions = new Map();
  const functionPattern = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
  const arrowPattern = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s*)?\(([^)]*)\)\s*=>/g;
  let match;

  while ((match = functionPattern.exec(content))) {
    functions.set(match[1], {
      name: match[1],
      kind: match[0].includes("async") ? "async function" : "function",
      params: splitParams(match[2]),
      returns: "",
    });
  }

  while ((match = arrowPattern.exec(content))) {
    functions.set(match[1], {
      name: match[1],
      kind: match[2] ? "async arrow function" : "arrow function",
      params: splitParams(match[3]),
      returns: "",
    });
  }

  return Array.from(functions.values());
}

function splitParams(params = "") {
  return params
    .split(",")
    .map((param) => param.trim())
    .filter(Boolean);
}

function extractComponents({ path, content, functions, defaultExport, namedExports }) {
  if (!path.endsWith(".jsx")) return [];

  const names = new Set([
    ...functions.map((fn) => fn.name),
    ...namedExports,
    defaultExport,
  ].filter(Boolean));

  return Array.from(names)
    .filter((name) => /^[A-Z]/.test(name) && content.includes("<"))
    .map((name) => ({
      name,
      kind: "React component",
      props: [],
    }));
}

function extractApiRoutes(content = "") {
  const routes = [];
  const routePattern = /\b(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]\s*,([\s\S]*?)\)/g;
  let match;

  while ((match = routePattern.exec(content))) {
    routes.push({
      method: match[1].toUpperCase(),
      path: match[2],
      handler: extractHandlerName(match[3]),
      requiresAuth: /auth|authenticate|authorize/i.test(match[3]),
      responseShape: extractResponseShape(content),
    });
  }

  return routes;
}

function extractHandlerName(routeArgs = "") {
  const candidates = routeArgs
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return candidates[candidates.length - 1]?.replace(/[);]/g, "") || "";
}

function extractApiCalls(content = "", apiEndpoints = []) {
  const calls = [];

  for (const endpoint of apiEndpoints) {
    const path = endpoint.path;
    if (path && content.includes(path)) {
      calls.push({
        method: endpoint.method || "",
        path,
        caller: "",
        responseDataPath: inferResponseDataPath(content),
      });
    }
  }

  return calls;
}

function inferResponseDataPath(content = "") {
  if (content.includes("response.data.data.")) return "response.data.data.<field>";
  if (content.includes("response.data.data")) return "response.data.data";
  if (content.includes(".data.data.")) return "response.data.data.<field>";
  if (content.includes(".data.data")) return "response.data.data";
  return "";
}

function extractDbTables(content = "", blueprint = {}) {
  return (blueprint.dbSchema?.tables || [])
    .map((table) => table.name)
    .filter((tableName) => tableName && content.includes(tableName));
}

function extractDbOperations(content = "", dbTables = []) {
  const operations = [];
  const operationMap = [
    ["select", /\bSELECT\b/i],
    ["insert", /\bINSERT\s+INTO\b/i],
    ["update", /\bUPDATE\b/i],
    ["delete", /\bDELETE\s+FROM\b/i],
  ];

  for (const table of dbTables) {
    for (const [operation, pattern] of operationMap) {
      if (pattern.test(content)) {
        operations.push({
          table,
          operation,
          functionName: "",
          safeQuery: usesParameterizedQuery(content),
        });
      }
    }
  }

  return operations;
}

function usesParameterizedQuery(content = "") {
  return /\$\d+/.test(content) || /\?\s*[,)]/.test(content);
}

function extractEnvVars(content = "") {
  const vars = new Set();
  const pattern = /(?:process\.env|import\.meta\.env)\.([A-Z0-9_]+)/g;
  let match;

  while ((match = pattern.exec(content))) {
    vars.add(match[1]);
  }

  return Array.from(vars);
}

function extractSideEffects({ path, content }) {
  const sideEffects = [];

  if (/\.listen\s*\(/.test(content)) sideEffects.push("starts HTTP server");
  if (/app\.use\s*\(/.test(content)) sideEffects.push("registers Express middleware or routes");
  if (/createContext\s*\(/.test(content)) sideEffects.push("creates React context");
  if (/axios\.create\s*\(/.test(content)) sideEffects.push("configures axios client");
  if (/new\s+Pool\s*\(/.test(content)) sideEffects.push("creates PostgreSQL connection pool");
  if (/mongoose\.connect\s*\(/.test(content)) sideEffects.push("connects to MongoDB");
  if (path.endsWith("main.jsx")) sideEffects.push("mounts React application");

  return sideEffects;
}

function extractResponseShape(content = "") {
  if (/success\s*:\s*true[\s\S]*data\s*:/.test(content)) {
    return "{ success: true, data: ... }";
  }

  if (/success\s*:\s*false[\s\S]*message\s*:/.test(content)) {
    return "{ success: false, message: string }";
  }

  return "";
}

function buildDataPersistenceSummary({ path, dbOperations }) {
  if (!dbOperations.length) return "";

  const operations = Array.from(new Set(dbOperations.map((item) => item.operation))).join("/");
  const tables = Array.from(new Set(dbOperations.map((item) => item.table))).join(", ");
  const safeQuery = dbOperations.every((item) => item.safeQuery);

  return `${path} performs ${operations} on ${tables}${safeQuery ? " with parameterized queries" : ""}.`;
}

function extractConventions({ path, content }) {
  const conventions = [];

  if (/\bimport\b|\bexport\b/.test(content)) conventions.push("ES modules");
  if (!/\brequire\s*\(/.test(content) && /\.(js|jsx)$/.test(path)) conventions.push("no CommonJS require");
  if (usesParameterizedQuery(content)) conventions.push("parameterized SQL");
  if (/\{[\s\S]*success\s*:\s*(?:true|false)/.test(content)) conventions.push("standard API response envelope");
  if (path.endsWith(".jsx") && /use(State|Effect|Context|Memo|Callback)\s*\(/.test(content)) conventions.push("React hooks");
  if (path.endsWith(".jsx") && /className=/.test(content)) conventions.push("Tailwind/className styling");

  return conventions;
}

function buildInterfaceSummary({
  path,
  defaultExport,
  namedExports,
  functions,
  components,
  apiRoutes,
  apiCalls,
  dbTables,
}) {
  const parts = [];

  if (defaultExport) parts.push(`default export ${defaultExport}`);
  if (namedExports.length) parts.push(`named exports ${namedExports.join(", ")}`);
  if (functions.length) parts.push(`functions ${functions.map((fn) => fn.name).join(", ")}`);
  if (components.length) parts.push(`components ${components.map((component) => component.name).join(", ")}`);
  if (apiRoutes.length) parts.push(`routes ${apiRoutes.map((route) => `${route.method} ${route.path}`).join(", ")}`);
  if (apiCalls.length) parts.push(`API calls ${apiCalls.map((call) => `${call.method} ${call.path}`).join(", ")}`);
  if (dbTables.length) parts.push(`DB tables ${dbTables.join(", ")}`);

  return parts.length ? parts.join(". ") : `${path} has no detected public interface.`;
}

function buildImportStatement(filePath, namedExports = [], defaultExport = null) {
  if (!isImportableFile(filePath)) return "";

  const importSource = `./${filePath.split("/").pop()}`;

  if (defaultExport && namedExports.length > 0) {
    return `import ${defaultExport}, { ${namedExports.join(", ")} } from '${importSource}';`;
  }

  if (defaultExport) {
    return `import ${defaultExport} from '${importSource}';`;
  }

  if (namedExports.length > 0) {
    return `import { ${namedExports.join(", ")} } from '${importSource}';`;
  }

  return "";
}

function mergeUniqueStrings(...lists) {
  const values = new Set();

  for (const list of lists) {
    for (const item of normalizeStringList(list)) {
      values.add(item);
    }
  }

  return Array.from(values);
}

function mergeObjects(fallbackList = [], modelList = [], getKey = (item) => JSON.stringify(item)) {
  const items = new Map();

  for (const item of normalizeObjectList(fallbackList)) {
    items.set(getKey(item), item);
  }

  for (const item of normalizeObjectList(modelList)) {
    items.set(getKey(item), item);
  }

  return Array.from(items.values());
}

function routeKey(route = {}) {
  return `${route.method || ""} ${route.path || ""}`;
}

function callKey(call = {}) {
  return `${call.method || ""} ${call.path || ""} ${call.caller || ""}`;
}

function dbOperationKey(operation = {}) {
  return `${operation.table || ""} ${operation.operation || ""} ${operation.functionName || ""}`;
}

function findCoderNotes(coderOutput, filePath) {
  const file = (coderOutput?.files || []).find((item) => item.path === filePath);
  return file?.notes || "";
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeObjectList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}
