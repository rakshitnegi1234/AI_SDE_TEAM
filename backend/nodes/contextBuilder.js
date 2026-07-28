
//  contextBuilder gives coder:
//   - current task
//   - files to create
//   - files needed
//   - app/auth info
//   - dependencies
//   - entity/file naming map
//   - existing file interfaces from registry
//   - DB schema for backend/integration tasks
//   - API endpoint contracts for backend/frontend/integration tasks
//   - completed file registry summaries
//   - implementation conventions


export function contextBuilderNode(state) {
  const {
    blueprint,
    currentTask,
    fileRegistry = [],
    sandboxRuntime = {},
  } = state;

  if (!currentTask) {
    return { contextPackage: null };
  }

  const filesToCreate = normalizePathList(currentTask.filesToCreate);
  const filesNeeded = normalizePathList(currentTask.filesNeeded);
  const taskPaths = [...filesToCreate, ...filesNeeded];
  const taskClassification = buildTaskClassification(filesToCreate);
  const relevantEntities = buildRelevantEntities(blueprint?.entities, taskPaths);
  const relevantTables = buildRelevantTables(blueprint?.dbSchema, relevantEntities);
  const relevantFrontendPages = buildRelevantFrontendPages(blueprint?.frontendPages, filesToCreate);
  const relevantApiEndpoints = buildRelevantApiEndpoints({
    apiEndpoints: blueprint?.apiEndpoints,
    relevantEntities,
    relevantFrontendPages,
    filesToCreate,
  });
  const namingMap = buildNamingMap(blueprint?.entities);
  const completedFiles = buildCompletedFiles(fileRegistry);
  const dependencyInterfaces = buildDependencyInterfaces({
    filesNeeded,
    filesToCreate,
    fileRegistry,
  });
  const app = buildAppInfo(blueprint, sandboxRuntime);
  const auth = buildAuthInfo(blueprint);
  const conventions = buildConventions({ authRequired: auth.required });

  const context = {
    task: {
      taskId: currentTask.taskId,
      phaseName: currentTask.phaseName || "",
      phaseNumber: currentTask.phaseNumber || null,
      title: currentTask.title,
      description: currentTask.description,
      filesToCreate,
      filesNeeded,
      acceptanceCriteria: currentTask.acceptanceCriteria || [],
      canParallelize: Boolean(currentTask.canParallelize),
    },

    fileContract: {
      filesToCreate,
      filesNeeded,
      taskPaths,
      maxFilesPerTask: 3,
      pathRule: "Use project-relative paths only. Do not create files outside filesToCreate.",
    },

    taskClassification,

    app,
    auth,
    appName: app.name,
    authRequired: auth.required,
    debugContext: buildDebugContext(state.debugState),

    dependencies: blueprint?.dependencies || {},
    folderStructure: blueprint?.folderStructure || "",
    namingMap,
    conventions,
    relevantEntities,
    relevantTables,
    relevantApiEndpoints,
    relevantFrontendPages,
    sharedComponents: blueprint?.sharedComponents || [],
    completedFiles,
    completedFileRegistry: completedFiles,
    dependencyInterfaces,
    existingFileInterfaces: dependencyInterfaces,

    dbSchema: shouldIncludeDbSchema(filesToCreate)
      ? blueprint?.dbSchema || null
      : null,

    apiEndpoints: shouldIncludeApiEndpoints(filesToCreate)
      ? buildApiEndpointContext({
        allEndpoints: blueprint?.apiEndpoints,
        relevantEndpoints: relevantApiEndpoints,
        filesToCreate,
      })
      : null,

    apiResponseContract: shouldIncludeApiEndpoints(filesToCreate)
      ? buildApiResponseContract()
      : null,
  };

  return {
    contextPackage: context,
  };
}

function normalizePathList(paths = []) {
  return Array.isArray(paths)
    ? paths.map((path) => String(path || "").trim()).filter(Boolean)
    : [];
}

function blueprintRequiresAuth(blueprint = {}) {
  return Boolean(
    (blueprint.apiEndpoints || []).some((endpoint) => endpoint.requiresAuth) ||
    (blueprint.frontendPages || []).some((page) => page.requiresAuth) ||
    (blueprint.folderStructure || "").includes("AuthContext.jsx") ||
    (blueprint.folderStructure || "").includes("backend/src/middleware/auth.js") ||
    blueprint.dependencies?.backend?.dependencies?.jsonwebtoken
  );
}

function buildTaskClassification(filesToCreate = []) {
  return {
    isBackendTask: isBackendTask(filesToCreate),
    isFrontendTask: isFrontendTask(filesToCreate),
    isIntegrationTask: isIntegrationTask(filesToCreate),
    isSetupTask: filesToCreate.some((filePath) =>
      [
        ".gitignore",
        "backend/package.json",
        "backend/.env.example",
        "backend/src/config/db.js",
        "frontend/package.json",
        "frontend/.env.example",
        "frontend/index.html",
        "frontend/vite.config.js",
        "frontend/tailwind.config.js",
        "frontend/postcss.config.js",
        "frontend/src/main.jsx",
        "frontend/src/index.css",
        "frontend/src/utils/api.js",
      ].includes(filePath)
    ),
    writesModels: filesToCreate.some((filePath) => filePath.startsWith("backend/src/models/")),
    writesControllers: filesToCreate.some((filePath) => filePath.startsWith("backend/src/controllers/")),
    writesRoutes: filesToCreate.some((filePath) => filePath.startsWith("backend/src/routes/")),
    writesPages: filesToCreate.some((filePath) => filePath.startsWith("frontend/src/pages/")),
    writesComponents: filesToCreate.some((filePath) => filePath.startsWith("frontend/src/components/")),
  };
}

function buildAppInfo(blueprint = {}, sandboxRuntime = {}) {
  const frontendPages = blueprint.frontendPages || [];
  const apiEndpoints = blueprint.apiEndpoints || [];

  return {
    name: blueprint.appName || blueprint.name || "generated-app",
    databaseType: blueprint.dbSchema?.databaseType || "",
    entities: (blueprint.entities || []).map((entity) => ({
      name: entity.name,
      description: entity.description || "",
      tableName: entity.tableName,
      apiPath: entity.apiPath,
    })),
    roles: extractRolesFromBlueprint(blueprint),
    pages: frontendPages.map((page) => ({
      name: page.name,
      route: page.route,
      description: page.description || "",
      requiresAuth: Boolean(page.requiresAuth),
    })),
    workflows: [
      ...frontendPages.map((page) => page.description).filter(Boolean),
      ...apiEndpoints.map((endpoint) => endpoint.description).filter(Boolean),
    ],
    runtime: {
      backendUrl: sandboxRuntime.backendUrl || "",
      frontendUrl: sandboxRuntime.frontendUrl || "",
      backendPort: sandboxRuntime.backendPort || null,
      frontendPort: sandboxRuntime.frontendPort || null,
      frontendEnv: sandboxRuntime.frontendEnv || {},
      backendEnv: sandboxRuntime.backendEnv || {},
    },
  };
}

function buildAuthInfo(blueprint = {}) {
  const required = blueprintRequiresAuth(blueprint);
  const protectedApiEndpoints = (blueprint.apiEndpoints || [])
    .filter((endpoint) => endpoint.requiresAuth)
    .map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      roleAccess: endpoint.roleAccess || [],
      relatedTable: endpoint.relatedTable || "",
    }));
  const publicAuthEndpoints = (blueprint.apiEndpoints || [])
    .filter((endpoint) => String(endpoint.path || "").startsWith("/api/v1/auth/"))
    .map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      requestBody: endpoint.requestBody || {},
      responseBody: endpoint.responseBody || {},
    }));
  const protectedPages = (blueprint.frontendPages || [])
    .filter((page) => page.requiresAuth)
    .map((page) => ({
      name: page.name,
      route: page.route,
      layout: page.layout || "",
    }));

  return {
    required,
    roles: extractRolesFromBlueprint(blueprint),
    userEntity: (blueprint.entities || []).find((entity) => entity.name === "User") || null,
    authFiles: {
      backendMiddleware: required ? "backend/src/middleware/auth.js" : "",
      frontendContext: required ? "frontend/src/context/AuthContext.jsx" : "",
    },
    protectedApiEndpoints,
    publicAuthEndpoints,
    protectedPages,
  };
}

function extractRolesFromBlueprint(blueprint = {}) {
  const roles = new Set();

  for (const endpoint of blueprint.apiEndpoints || []) {
    for (const role of endpoint.roleAccess || []) {
      const normalizedRole = String(role || "").trim();
      if (normalizedRole) roles.add(normalizedRole);
    }
  }

  for (const page of blueprint.frontendPages || []) {
    for (const role of page.roleAccess || []) {
      const normalizedRole = String(role || "").trim();
      if (normalizedRole) roles.add(normalizedRole);
    }
  }

  return Array.from(roles);
}

function buildDebugContext(debugState = {}) {
  if (!debugState.rollbackAttempted || !debugState.rollbackContext) {
    return null;
  }

  return {
    rollbackAttempted: true,
    ...debugState.rollbackContext,
  };
}

function buildNamingMap(entities = []) {
  return entities.map((entity) => ({
    entity: entity.name,
    tableName: entity.tableName,
    apiPath: entity.apiPath,
    modelFile: entity.modelFile,
    routeFile: entity.routeFile,
    modelPath: entity.modelFile ? `backend/src/models/${entity.modelFile}.js` : "",
    controllerPath: entity.modelFile ? `backend/src/controllers/${entity.modelFile}Controller.js` : "",
    routePath: entity.routeFile ? `backend/src/routes/${entity.routeFile}.js` : "",
    relationshipFields: (entity.relationships || []).map((relationship) => ({
      target: relationship.target,
      type: relationship.type,
      foreignKey: relationship.foreignKey,
    })),
  }));
}

function buildDependencyInterfaces({
  filesNeeded,
  filesToCreate,
  fileRegistry,
}) {
  const interfaces = {};

  for (const filePath of filesNeeded) {
    if (filesToCreate.includes(filePath)) {
      continue;
    }

    const registryEntry = fileRegistry.find((entry) => entry.path === filePath);

    if (!registryEntry) {
      continue;
    }

    interfaces[filePath] = {
      fileKind: registryEntry.fileKind || "",
      defaultExport: registryEntry.defaultExport || null,
      namedExports: registryEntry.namedExports || [],
      importStatement: registryEntry.importStatement,
      exports: registryEntry.exports,
      interface: registryEntry.interface,
      imports: registryEntry.imports || [],
      localImports: registryEntry.localImports || [],
      packageImports: registryEntry.packageImports || [],
      apiRoutes: registryEntry.apiRoutes || [],
      apiCalls: registryEntry.apiCalls || [],
      dbTables: registryEntry.dbTables || [],
      dbOperations: registryEntry.dbOperations || [],
      envVars: registryEntry.envVars || [],
      dependencies: registryEntry.dependencies || [],
      sideEffects: registryEntry.sideEffects || [],
      responseShape: registryEntry.responseShape || "",
      dataPersistence: registryEntry.dataPersistence || "",
    };
  }

  return interfaces;
}

function buildCompletedFiles(fileRegistry = []) {
  return fileRegistry.map((file) => ({
    path: file.path,
    fileKind: file.fileKind || "",
    defaultExport: file.defaultExport || null,
    namedExports: file.namedExports || [],
    exports: file.exports || [],
    imports: file.imports || [],
    localImports: file.localImports || [],
    packageImports: file.packageImports || [],
    importStatement: file.importStatement || "",
    interface: file.interface || "",
    apiRoutes: file.apiRoutes || [],
    apiCalls: file.apiCalls || [],
    dbTables: file.dbTables || [],
    dbOperations: file.dbOperations || [],
    envVars: file.envVars || [],
    dependencies: file.dependencies || [],
    sideEffects: file.sideEffects || [],
    responseShape: file.responseShape || "",
    dataPersistence: file.dataPersistence || "",
    taskId: file.taskId || "",
    phaseName: file.phaseName || "",
  }));
}

function buildRelevantEntities(entities = [], filePaths = []) {
  const normalizedPaths = filePaths.map((filePath) => String(filePath || "").toLowerCase());

  return (entities || []).filter((entity) => {
    const markers = [
      entity.name,
      entity.tableName,
      entity.modelFile,
      entity.routeFile,
      entity.apiPath,
      entity.modelFile ? `${entity.modelFile}Controller` : "",
      entity.modelFile ? `backend/src/models/${entity.modelFile}.js` : "",
      entity.modelFile ? `backend/src/controllers/${entity.modelFile}Controller.js` : "",
      entity.routeFile ? `backend/src/routes/${entity.routeFile}.js` : "",
    ].filter(Boolean).map((marker) => String(marker).toLowerCase());

    return markers.some((marker) =>
      normalizedPaths.some((filePath) => filePath.includes(marker))
    );
  });
}

function buildRelevantTables(dbSchema = {}, relevantEntities = []) {
  const tableNames = new Set(relevantEntities.map((entity) => entity.tableName));

  if (tableNames.size === 0) {
    return [];
  }

  return (dbSchema.tables || []).filter((table) => tableNames.has(table.name));
}

function buildRelevantApiEndpoints({
  apiEndpoints = [],
  relevantEntities = [],
  relevantFrontendPages = [],
  filesToCreate = [],
}) {
  const tableNames = new Set(relevantEntities.map((entity) => entity.tableName));
  const apiPaths = new Set(relevantEntities.map((entity) => entity.apiPath));
  const frontendApiCalls = new Set(
    relevantFrontendPages.flatMap((page) =>
      (page.components || []).flatMap((component) => component.apiCalls || [])
    )
  );
  const isIntegration = filesToCreate.some((filePath) =>
    ["backend/src/index.js", "frontend/src/App.jsx"].includes(filePath)
  );

  if (isIntegration) {
    return apiEndpoints || [];
  }

  return (apiEndpoints || []).filter((endpoint) =>
    tableNames.has(endpoint.relatedTable) ||
    Array.from(apiPaths).some((apiPath) =>
      endpoint.path === apiPath || endpoint.path?.startsWith(`${apiPath}/`)
    ) ||
    Array.from(frontendApiCalls).some((apiCall) => apiCallMatchesEndpoint(apiCall, endpoint)) ||
    endpoint.path?.startsWith("/api/v1/auth/")
  );
}

function apiCallMatchesEndpoint(apiCall, endpoint) {
  const [method, ...pathParts] = String(apiCall || "").trim().split(/\s+/);
  const path = pathParts.join(" ");

  if (!method || !path) {
    return false;
  }

  return method.toUpperCase() === String(endpoint.method || "").toUpperCase() &&
    path === endpoint.path;
}

function buildRelevantFrontendPages(frontendPages = [], filesToCreate = []) {
  const isIntegration = filesToCreate.includes("frontend/src/App.jsx");

  if (isIntegration) {
    return frontendPages || [];
  }

  return (frontendPages || []).filter((page) =>
    filesToCreate.some((filePath) =>
      filePath.includes(`${page.name}.jsx`) ||
      (page.components || []).some((component) => filePath.includes(`${component.name}.jsx`))
    )
  );
}

function isBackendTask(filesToCreate) {
  return filesToCreate.some((filePath) => filePath.startsWith("backend/"));
}

function isFrontendTask(filesToCreate) {
  return filesToCreate.some((filePath) => filePath.startsWith("frontend/"));
}

function isIntegrationTask(filesToCreate) {
  return filesToCreate.some((filePath) =>
    ["backend/src/index.js", "frontend/src/App.jsx"].includes(filePath)
  );
}

function shouldIncludeDbSchema(filesToCreate) {
  return isBackendTask(filesToCreate) || isIntegrationTask(filesToCreate);
}

function shouldIncludeApiEndpoints(filesToCreate) {
  return isBackendTask(filesToCreate) || isFrontendTask(filesToCreate) || isIntegrationTask(filesToCreate);
}

function buildApiEndpointContext({
  allEndpoints = [],
  relevantEndpoints = [],
  filesToCreate = [],
}) {
  return isIntegrationTask(filesToCreate)
    ? allEndpoints || []
    : relevantEndpoints || [];
}

function buildApiResponseContract() {
  return {
    successEnvelope: "{ success: true, data: ... }",
    errorEnvelope: "{ success: false, message: string }",
    listDataPath: "response.data.data when the controller returns data as an array",
    nestedListDataPath: "response.data.data.<exactKey> only when the controller returns data: { <exactKey>: [...] }",
    singleItemDataPath: "response.data.data",
    createDataPath: "response.data.data",
    updateDataPath: "response.data.data",
    deleteMessagePath: "response.data.data.message",
    rule: "Do not invent nested response keys. Inspect the backend controller response and use the exact data shape it returns.",
    forbiddenTopLevelReads: [
      "response.data.tasks",
      "response.data.task",
      "response.data.total",
      "response.data.pagination",
    ],
  };
}

function buildConventions({ authRequired }) {
  return {
    stack: {
      backend: "Node.js, Express, ES modules",
      frontend: "React, Vite, Tailwind CSS, React Router",
      database: "Use the blueprint dbSchema.databaseType and dependency contract.",
    },
    files: [
      "Write only files listed in task.filesToCreate.",
      "Use project-relative paths.",
      "Each generated file must be complete and runnable.",
      "No TODO-only files, mock-only behavior, or placeholders for requested functionality.",
    ],
    imports: [
      "Use ES module import/export syntax.",
      "Include .js on backend local imports.",
      "Use existing registry import statements when importing generated files.",
    ],
    naming: [
      "Entity names are PascalCase singular.",
      "Table and DB field names are snake_case.",
      "API paths use /api/v1 plus kebab-case plural resources.",
      "Model files use backend/src/models/{entity.modelFile}.js.",
      "Controller files use backend/src/controllers/{entity.modelFile}Controller.js.",
      "Route files use backend/src/routes/{entity.routeFile}.js.",
      "Page files use frontend/src/pages/{page.name}.jsx.",
      "Component files use frontend/src/components/{component.name}.jsx.",
    ],
    backend: [
      "Express responses use { success: true, data: ... } or { success: false, message: string }.",
      "Database code must use parameterized queries for SQL.",
      "Model functions should return clean data, not raw database driver envelopes.",
      authRequired
        ? "Protected routes must use auth middleware from backend/src/middleware/auth.js."
        : "Do not add auth checks unless the blueprint requires auth.",
    ],
    frontend: [
      "Use controlled form inputs.",
      "Show loading, error, and empty states for async data.",
      "Call exact API endpoint paths from the context.",
      "Read backend response data using the actual response envelope.",
      "Use import.meta.env for frontend environment variables.",
    ],
    environment: [
      "Backend uses process.env.DATABASE_URL, JWT_SECRET, and PORT when needed.",
      "Frontend API clients use import.meta.env.VITE_API_BASE_URL when calling the backend.",
      "Do not hard-code localhost backend ports in frontend source. Use the runtime env values from context.",
      "Never include real secrets in generated files.",
    ],
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}
