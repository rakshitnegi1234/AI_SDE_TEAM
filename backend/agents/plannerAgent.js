import {
  AUTH_SETUP_FILES,
  MANDATORY_PHASES,
  REQUIRED_DOCUMENTATION_FILES,
  REQUIRED_SETUP_FILES,
  blueprintRequiresAuth,
} from "./plannerValidator.js";

export async function plannerAgentNode(state) {
  console.log("\n[Planner Agent] Building task plan from blueprint\n");

  return {
    taskQueue: buildTaskQueue(state.blueprint || {}),
    currentPhaseIndex: 0,
    currentTaskIndex: 0,
  };
}

function buildTaskQueue(blueprint) {
  const architectFiles = extractFilesFromFolderStructure(blueprint.folderStructure || "");
  const files = new Set([...architectFiles, ".gitignore", ...REQUIRED_DOCUMENTATION_FILES]);
  const authRequired = blueprintRequiresAuth(blueprint);
  const setupFiles = orderedExistingFiles([
    ...REQUIRED_SETUP_FILES,
    ...(authRequired ? AUTH_SETUP_FILES : []),
  ], files);

  const used = new Set(setupFiles);
  const phaseFiles = {
    setup: setupFiles,
    models: takeFiles(files, used, isModelFile),
    middleware: takeFiles(files, used, isMiddlewareFile),
    backend: sortBackendFiles(takeFiles(files, used, isBackendFeatureFile)),
    frontend: sortFrontendFiles(takeFiles(files, used, isFrontendFeatureFile)),
    integration: integrationFiles(files),
    documentation: REQUIRED_DOCUMENTATION_FILES,
  };

  const leftovers = takeFiles(files, used, (file) =>
    file !== "README.md" && file !== ".gitignore"
  );

  for (const file of leftovers) {
    if (file.startsWith("backend/")) phaseFiles.backend.push(file);
    else if (file.startsWith("frontend/")) phaseFiles.frontend.push(file);
    else phaseFiles.setup.push(file);
  }

  return {
    phases: MANDATORY_PHASES.map((phaseName, index) => ({
      phaseNumber: index + 1,
      phaseName,
      description: descriptionForPhase(phaseName),
      tasks: buildTasksForPhase({
        phaseName,
        files: unique(phaseFiles[phaseName] || []),
        blueprint,
      }),
    })),
  };
}

function buildTasksForPhase({ phaseName, files, blueprint }) {
  if (phaseName === "middleware" && files.length === 0) {
    return [];
  }

  const chunks = chunk(files, chunkSizeForPhase(phaseName));

  return chunks.map((filesToCreate, index) => ({
    taskId: `${phaseName}-${index + 1}`,
    title: titleForTask(phaseName, filesToCreate),
    description: descriptionForTask(phaseName, filesToCreate),
    filesToCreate,
    filesNeeded: filesNeededFor({ phaseName, filesToCreate, blueprint }),
    acceptanceCriteria: acceptanceCriteriaFor(phaseName, filesToCreate),
    canParallelize: ["models", "backend", "frontend"].includes(phaseName),
  }));
}

function chunkSizeForPhase(phaseName) {
  if (["backend", "frontend", "integration", "documentation"].includes(phaseName)) {
    return 1;
  }

  return 3;
}

function filesNeededFor({ phaseName, filesToCreate, blueprint }) {
  if (phaseName === "setup" || phaseName === "models" || phaseName === "documentation") {
    return [];
  }

  const needed = new Set();

  if (phaseName === "middleware") {
    addIfCreated(needed, "backend/src/config/db.js", filesToCreate);
  }

  if (phaseName === "backend") {
    addIfCreated(needed, "backend/src/config/db.js", filesToCreate);
    addRelatedModelFiles(needed, filesToCreate, blueprint);
    addRelatedControllerFiles(needed, filesToCreate, blueprint);
    if (blueprintRequiresAuth(blueprint)) addIfCreated(needed, "backend/src/middleware/auth.js", filesToCreate);
  }

  if (phaseName === "frontend") {
    addIfCreated(needed, "frontend/src/utils/api.js", filesToCreate);
    if (blueprintRequiresAuth(blueprint)) addIfCreated(needed, "frontend/src/context/AuthContext.jsx", filesToCreate);
  }

  if (phaseName === "integration") {
    for (const entity of blueprint.entities || []) {
      addIfCreated(needed, `backend/src/routes/${entity.routeFile}.js`, filesToCreate);
    }
    for (const page of blueprint.frontendPages || []) {
      addIfCreated(needed, `frontend/src/pages/${page.name}.jsx`, filesToCreate);
    }
    for (const component of blueprint.sharedComponents || []) {
      addIfCreated(needed, `frontend/src/components/${component.name}.jsx`, filesToCreate);
    }
  }

  return Array.from(needed);
}

function addRelatedModelFiles(needed, filesToCreate, blueprint) {
  for (const entity of blueprint.entities || []) {
    const modelPath = `backend/src/models/${entity.modelFile}.js`;
    const controllerPath = `backend/src/controllers/${entity.modelFile}Controller.js`;
    const routePath = `backend/src/routes/${entity.routeFile}.js`;

    if (filesToCreate.includes(controllerPath) || filesToCreate.includes(routePath)) {
      addIfCreated(needed, modelPath, filesToCreate);
    }
  }
}

function addRelatedControllerFiles(needed, filesToCreate, blueprint) {
  for (const entity of blueprint.entities || []) {
    const controllerPath = `backend/src/controllers/${entity.modelFile}Controller.js`;
    const routePath = `backend/src/routes/${entity.routeFile}.js`;

    if (filesToCreate.includes(routePath)) {
      addIfCreated(needed, controllerPath, filesToCreate);
    }
  }
}

function addIfCreated(needed, filePath, filesToCreate) {
  if (!filesToCreate.includes(filePath)) {
    needed.add(filePath);
  }
}

function orderedExistingFiles(paths, allowedFiles) {
  return unique(paths).filter((file) => allowedFiles.has(file));
}

function takeFiles(files, used, predicate) {
  const selected = [];

  for (const file of files) {
    if (used.has(file) || !predicate(file)) continue;
    used.add(file);
    selected.push(file);
  }

  return selected;
}

function integrationFiles(files) {
  return [
    "backend/src/index.js",
    "frontend/src/App.jsx",
  ].filter((file) => files.has(file));
}

function isModelFile(file) {
  return file.startsWith("backend/src/models/") && file.endsWith(".js");
}

function isMiddlewareFile(file) {
  return file.startsWith("backend/src/middleware/") && file.endsWith(".js");
}

function isBackendFeatureFile(file) {
  return file.startsWith("backend/src/controllers/") ||
    file.startsWith("backend/src/routes/") ||
    file.startsWith("backend/src/utils/");
}

function isFrontendFeatureFile(file) {
  return file.startsWith("frontend/src/pages/") ||
    file.startsWith("frontend/src/components/") ||
    file.startsWith("frontend/src/hooks/") ||
    file.startsWith("frontend/src/context/");
}

function sortBackendFiles(files) {
  const rank = (file) => {
    if (file.startsWith("backend/src/controllers/")) return 1;
    if (file.startsWith("backend/src/routes/")) return 2;
    return 3;
  };

  return [...files].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function sortFrontendFiles(files) {
  const rank = (file) => {
    if (file.startsWith("frontend/src/context/")) return 1;
    if (file.startsWith("frontend/src/hooks/")) return 2;
    if (file.startsWith("frontend/src/components/")) return 3;
    if (file.startsWith("frontend/src/pages/")) return 4;
    return 5;
  };

  return [...files].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function descriptionForPhase(phaseName) {
  const descriptions = {
    setup: "Create base project files and shared runtime setup.",
    models: "Create database model files.",
    middleware: "Create middleware files from the blueprint.",
    backend: "Create backend controllers, routes, and utilities.",
    frontend: "Create frontend pages, components, hooks, and context files.",
    integration: "Wire backend routes and frontend routes into entry files.",
    documentation: "Create final project documentation.",
  };

  return descriptions[phaseName] || `Create ${phaseName} files.`;
}

function titleForTask(phaseName, files) {
  return `${capitalize(phaseName)}: ${files.map(shortName).join(", ")}`;
}

function descriptionForTask(phaseName, files) {
  return `Create or update ${files.join(", ")} for the ${phaseName} phase.`;
}

function acceptanceCriteriaFor(phaseName, files) {
  return [
    `Writes exactly: ${files.join(", ")}`,
    `Matches the validated blueprint ${phaseName} contract.`,
  ];
}

function shortName(filePath) {
  return filePath.split("/").pop();
}

function capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function extractFilesFromFolderStructure(folderStructure) {
  const files = [];
  const stack = [];

  for (const line of String(folderStructure).split("\n")) {
    if (!line.trim()) continue;

    const firstPathChar = line.search(/[A-Za-z0-9_.]/);
    const indent = firstPathChar === -1 ? 0 : firstPathChar;
    const name = cleanTreeLine(line);

    if (!name || name === "." || name === "/") continue;
    if (/^(project-root|project root|root)\/?$/i.test(name)) continue;

    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parentPath = stack.length ? stack[stack.length - 1].path : "";
    const path = normalizeProjectPath(joinPath(parentPath, name.replace(/\/$/, "")));

    if (name.endsWith("/")) {
      stack.push({ indent, path });
    } else {
      files.push(path);
    }
  }

  return unique(files);
}

function cleanTreeLine(line) {
  return line
    .replace(/[│├└─]/g, "")
    .trim()
    .replace(/^- /, "")
    .trim();
}

function joinPath(parentPath, childName) {
  return parentPath ? `${parentPath}/${childName}` : childName;
}

function normalizeProjectPath(filePath = "") {
  return String(filePath)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^(root|project)\//i, "");
}
