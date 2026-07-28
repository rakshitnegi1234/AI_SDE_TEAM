const MAX_VALIDATION_CYCLES = 4;

export const MANDATORY_PHASES = [
  "setup",
  "models",
  "middleware",
  "backend",
  "frontend",
  "integration",
  "documentation",
];

export const REQUIRED_SETUP_FILES = [
  ".gitignore",
  "backend/package.json",
  "backend/.env.example",
  "backend/src/config/db.js",
  "backend/src/index.js",
  "frontend/package.json",
  "frontend/.env.example",
  "frontend/index.html",
  "frontend/vite.config.js",
  "frontend/tailwind.config.js",
  "frontend/postcss.config.js",
  "frontend/src/main.jsx",
  "frontend/src/App.jsx",
  "frontend/src/index.css",
  "frontend/src/utils/api.js",
];

export const AUTH_SETUP_FILES = [
  "backend/src/middleware/auth.js",
  "frontend/src/context/AuthContext.jsx",
];

export const REQUIRED_DOCUMENTATION_FILES = [
  "README.md",
];

const ALLOWED_NON_BLUEPRINT_FILES = new Set([
  ".gitignore",
  "README.md",
  "frontend/.env.example",
]);

const DISALLOWED_PLANNED_FILES = [
  "Dockerfile",
  "docker-compose.yml",
  "nginx.conf",
];

export function plannerValidatorNode(state) {
  console.log("\n[Planner Validator] Checking planner output against blueprint\n");

  const issues = [];
  const blueprint = state.blueprint || {};
  const taskQueue = state.taskQueue || {};
  const createdFiles = collectCreatedFiles(taskQueue, issues);
  const architectFiles = extractFilesFromFolderStructure(blueprint.folderStructure || "");

  validateTaskQueueShape(taskQueue, issues);
  validateMandatoryPhaseOrder(taskQueue, issues);
  validateTaskIds(taskQueue, issues);
  validatePathRules(taskQueue, issues);
  validateTaskFileCounts(taskQueue, issues);
  validateSetupPhaseFiles(taskQueue, blueprint, issues);
  validateDocumentationPhase(taskQueue, issues);
  validateDuplicateCreation(taskQueue, issues);
  validateDependencyOrder(taskQueue, issues);
  validateEntityFileNames(blueprint.entities || [], createdFiles, issues);
  validateFolderStructureCoverage(architectFiles, createdFiles, issues);
  validateCreatedFilesBelongToBlueprint(architectFiles, createdFiles, issues);

  return finishValidation(state, issues);
}

export function plannerValidatorRouter(state) {
  const validation = state.plannerValidation;

  if (validation?.isValid) {
    return "setupSandbox";
  }

  if ((validation?.validationCycles || 0) >= MAX_VALIDATION_CYCLES) {
    return "__end__";
  }

  return "plannerAgent";
}

function validateMandatoryPhaseOrder(taskQueue, issues) {
  const phases = taskQueue.phases || [];

  if (phases.length !== MANDATORY_PHASES.length) {
    addIssue(issues, "invalid_phase_count", "error", "plannerAgent",
      `Planner must return exactly ${MANDATORY_PHASES.length} phases: ${MANDATORY_PHASES.join(", ")}.`);
    return;
  }

  phases.forEach((phase, index) => {
    const expectedName = MANDATORY_PHASES[index];
    const actualName = normalizePhaseName(phase.phaseName);
    const expectedNumber = index + 1;

    if (actualName !== expectedName) {
      addIssue(issues, "invalid_phase_order", "error", "plannerAgent",
        `Phase ${expectedNumber} must be "${expectedName}", but found "${phase.phaseName}".`);
    }

    if (phase.phaseNumber !== expectedNumber) {
      addIssue(issues, "invalid_phase_number", "error", "plannerAgent",
        `Phase "${phase.phaseName || "unknown"}" must have phaseNumber ${expectedNumber}.`);
    }
  });
}

function validateTaskQueueShape(taskQueue, issues) {
  if (!Array.isArray(taskQueue.phases) || taskQueue.phases.length === 0) {
    addIssue(issues, "missing_phases", "error", "plannerAgent",
      "Planner output must include a non-empty phases array.");
    return;
  }

  for (const phase of taskQueue.phases) {
    if (!Array.isArray(phase.tasks)) {
      addIssue(issues, "missing_phase_tasks", "error", "plannerAgent",
        `Phase "${phase.phaseName || phase.phaseNumber || "unknown"}" must include a tasks array.`);
      continue;
    }

    for (const task of phase.tasks) {
      if (!task.taskId) {
        addIssue(issues, "missing_task_id", "error", "plannerAgent",
          "Every task must include taskId.");
      }

      if (!Array.isArray(task.filesToCreate) || task.filesToCreate.length === 0) {
        addIssue(issues, "missing_files_to_create", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" must include filesToCreate.`);
      }

      if (!Array.isArray(task.filesNeeded)) {
        addIssue(issues, "missing_files_needed", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" should include filesNeeded, even when empty.`);
      }

      if (typeof task.canParallelize !== "boolean") {
        addIssue(issues, "missing_parallel_flag", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" must include boolean canParallelize.`);
      }
    }
  }
}

function validateTaskIds(taskQueue, issues) {
  const seen = new Set();

  for (const task of allTasks(taskQueue)) {
    const taskId = String(task.taskId || "").trim();

    if (!taskId) {
      continue;
    }

    if (!/^[a-z]+-\d+$/.test(taskId)) {
      addIssue(issues, "invalid_task_id", "error", "plannerAgent",
        `Task id "${taskId}" must use the format "phaseName-N".`);
    }

    const expectedPrefix = normalizePhaseName(task.phaseName);
    if (expectedPrefix && !taskId.startsWith(`${expectedPrefix}-`)) {
      addIssue(issues, "task_id_phase_mismatch", "error", "plannerAgent",
        `Task id "${taskId}" must start with its phase name "${expectedPrefix}-".`);
    }

    if (seen.has(taskId)) {
      addIssue(issues, "duplicate_task_id", "error", "plannerAgent",
        `Task id "${taskId}" appears more than once.`);
    }

    seen.add(taskId);
  }
}

function validatePathRules(taskQueue, issues) {
  for (const task of allTasks(taskQueue)) {
    for (const filePath of [...(task.filesToCreate || []), ...(task.filesNeeded || [])]) {
      const normalizedPath = normalizeProjectPath(filePath);

      if (typeof filePath !== "string" || normalizedPath === "") {
        addIssue(issues, "invalid_file_path", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" contains an invalid file path.`);
        continue;
      }

      if (normalizedPath.startsWith("/") || normalizedPath.includes("..")) {
        addIssue(issues, "unsafe_file_path", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" uses unsafe path "${filePath}". Paths must be project-relative.`);
      }

      if (!normalizedPath.startsWith("backend/") && !normalizedPath.startsWith("frontend/") && normalizedPath !== ".gitignore" && normalizedPath !== "README.md") {
        addIssue(issues, "unexpected_file_root", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" uses path "${filePath}" outside expected project roots.`);
      }

      if (DISALLOWED_PLANNED_FILES.includes(normalizedPath.split("/").pop())) {
        addIssue(issues, "disallowed_deployment_file", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" plans "${normalizedPath}", but deployment files are not allowed.`);
      }
    }
  }
}

function validateTaskFileCounts(taskQueue, issues) {
  for (const task of allTasks(taskQueue)) {
    const fileCount = (task.filesToCreate || []).length;

    if (fileCount > 3) {
      addIssue(issues, "too_many_files_in_task", "error", "plannerAgent",
        `Task "${task.taskId || "unknown"}" creates ${fileCount} files. Each task may create or update at most 3 files.`);
    }
  }
}

function validateSetupPhaseFiles(taskQueue, blueprint, issues) {
  const setupPhase = findPhase(taskQueue, "setup");
  const setupFiles = new Set((setupPhase?.tasks || []).flatMap((task) =>
    (task.filesToCreate || []).map(normalizeProjectPath)
  ));
  const authRequired = blueprintRequiresAuth(blueprint);

  for (const filePath of REQUIRED_SETUP_FILES) {
    if (!setupFiles.has(filePath)) {
      addIssue(issues, "missing_setup_file", "error", "plannerAgent",
        `Setup phase must plan "${filePath}".`);
    }
  }

  if (authRequired) {
    for (const filePath of AUTH_SETUP_FILES) {
      if (!setupFiles.has(filePath)) {
        addIssue(issues, "missing_auth_setup_file", "error", "plannerAgent",
          `Auth-required apps must plan "${filePath}" in setup phase.`);
      }
    }
  }
}

export function blueprintRequiresAuth(blueprint = {}) {
  return Boolean(
    (blueprint.apiEndpoints || []).some((endpoint) => endpoint.requiresAuth) ||
    (blueprint.frontendPages || []).some((page) => page.requiresAuth) ||
    (blueprint.folderStructure || "").includes("AuthContext.jsx") ||
    (blueprint.folderStructure || "").includes("backend/src/middleware/auth.js") ||
    blueprint.dependencies?.backend?.dependencies?.jsonwebtoken
  );
}

function validateDocumentationPhase(taskQueue, issues) {
  const documentationPhase = findPhase(taskQueue, "documentation");
  const documentationFiles = new Set((documentationPhase?.tasks || []).flatMap((task) =>
    (task.filesToCreate || []).map(normalizeProjectPath)
  ));

  for (const filePath of REQUIRED_DOCUMENTATION_FILES) {
    if (!documentationFiles.has(filePath)) {
      addIssue(issues, "missing_documentation_file", "error", "plannerAgent",
        `Documentation phase must plan "${filePath}".`);
    }
  }

  for (const task of allTasks(taskQueue)) {
    const files = (task.filesToCreate || []).map(normalizeProjectPath);
    const hasReadme = files.includes("README.md");
    const isDocumentationPhase = normalizePhaseName(task.phaseName) === "documentation";

    if (hasReadme && !isDocumentationPhase) {
      addIssue(issues, "readme_outside_documentation", "error", "plannerAgent",
        `Task "${task.taskId || "unknown"}" creates README.md outside the documentation phase.`);
    }

    if (isDocumentationPhase && files.some((filePath) => filePath !== "README.md")) {
      addIssue(issues, "documentation_phase_extra_file", "error", "plannerAgent",
        `Documentation task "${task.taskId || "unknown"}" must create only README.md.`);
    }
  }
}

function validateDuplicateCreation(taskQueue, issues) {
  const firstCreation = new Map();

  for (const task of allTasks(taskQueue)) {
    for (const filePath of task.filesToCreate || []) {
      const normalizedPath = normalizeProjectPath(filePath);

      if (!firstCreation.has(normalizedPath)) {
        firstCreation.set(normalizedPath, task);
        continue;
      }

      if (!isAllowedIntegrationUpdate(task, normalizedPath)) {
        addIssue(issues, "duplicate_file_creation", "error", "plannerAgent",
          `File "${normalizedPath}" appears in filesToCreate more than once outside an allowed integration update.`);
      }
    }
  }
}

function isAllowedIntegrationUpdate(task, filePath) {
  const phaseName = String(task.phaseName || task.phase || "").toLowerCase();
  const taskId = String(task.taskId || "").toLowerCase();
  const title = String(task.title || "").toLowerCase();
  const isIntegrationTask =
    phaseName.includes("integration") ||
    taskId.startsWith("integration-") ||
    title.includes("integration") ||
    title.includes("wire");

  return isIntegrationTask && [
    "backend/src/index.js",
    "frontend/src/App.jsx",
  ].includes(filePath);
}

function validateDependencyOrder(taskQueue, issues) {
  const createdSoFar = new Set();

  for (const task of allTasks(taskQueue)) {
    for (const filePath of task.filesNeeded || []) {
      const normalizedPath = normalizeProjectPath(filePath);

      if (!createdSoFar.has(normalizedPath)) {
        addIssue(issues, "future_or_missing_dependency", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" needs "${normalizedPath}" before any earlier task creates it.`);
      }
    }

    for (const filePath of task.filesToCreate || []) {
      createdSoFar.add(normalizeProjectPath(filePath));
    }
  }
}

function validateEntityFileNames(entities, createdFiles, issues) {
  const created = new Set(createdFiles);

  for (const entity of entities) {
    if (entity.modelFile) {
      const modelPath = `backend/src/models/${entity.modelFile}.js`;

      if (!created.has(modelPath)) {
        addIssue(issues, "missing_entity_model_task", "error", "plannerAgent",
          `Planner must create model file "${modelPath}" from architect entity "${entity.name}".`);
      }
    }

    if (entity.routeFile) {
      const routePath = `backend/src/routes/${entity.routeFile}.js`;

      if (!created.has(routePath)) {
        addIssue(issues, "missing_entity_route_task", "error", "plannerAgent",
          `Planner must create route file "${routePath}" from architect entity "${entity.name}".`);
      }
    }
  }
}

function validateFolderStructureCoverage(architectFiles, createdFiles, issues) {
  if (architectFiles.length === 0) return;

  const created = new Set(createdFiles);

  for (const filePath of architectFiles) {
    if (!created.has(filePath)) {
      addIssue(issues, "missing_architect_file_task", "error", "plannerAgent",
        `Architect folder structure includes "${filePath}", but planner did not schedule it in filesToCreate.`);
    }
  }
}

function validateCreatedFilesBelongToBlueprint(architectFiles, createdFiles, issues) {
  const allowedFiles = new Set([
    ...architectFiles,
    ...ALLOWED_NON_BLUEPRINT_FILES,
  ]);

  for (const filePath of createdFiles) {
    if (!allowedFiles.has(filePath)) {
      addIssue(issues, "file_not_in_blueprint", "error", "plannerAgent",
        `Planner creates "${filePath}", but it is not in the validated blueprint folder structure.`);
    }
  }
}

function collectCreatedFiles(taskQueue, issues) {
  const files = [];

  for (const task of allTasks(taskQueue)) {
    for (const filePath of task.filesToCreate || []) {
      files.push(normalizeProjectPath(filePath));
    }
  }

  return files;
}

function allTasks(taskQueue) {
  return (taskQueue.phases || []).flatMap((phase) =>
    (phase.tasks || []).map((task) => ({
      ...task,
      phaseName: phase.phaseName,
    }))
  );
}

function findPhase(taskQueue, phaseName) {
  return (taskQueue.phases || []).find((phase) =>
    normalizePhaseName(phase.phaseName) === phaseName
  );
}

function extractFilesFromFolderStructure(folderStructure) {
  const files = [];
  const stack = [];

  for (const rawLine of String(folderStructure).split("\n")) {
    if (!rawLine.trim()) continue;

    const firstPathChar = rawLine.search(/[A-Za-z0-9_.]/);
    const indent = firstPathChar === -1 ? 0 : firstPathChar;
    const name = cleanTreeLine(rawLine);

    if (!name || name === "." || name === "/") continue;
    if (/^(project-root|project root|root)\/?$/i.test(name)) continue;

    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const explicitPath = name.includes("/") && !name.endsWith("/")
      ? name.replace(/\/$/, "")
      : "";
    const parentPath = stack.length ? stack[stack.length - 1].path : "";
    const path = normalizeProjectPath(
      explicitPath || joinPath(parentPath, name.replace(/\/$/, ""))
    );

    if (name.endsWith("/")) {
      stack.push({ indent, path });
      continue;
    }

    files.push(path);
  }

  return Array.from(new Set(files));
}

function normalizePhaseName(phaseName = "") {
  return String(phaseName).trim().toLowerCase();
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

function finishValidation(state, issues) {
  const currentCycles = state.plannerValidation?.validationCycles || 0;
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const isValid = errors.length === 0;

  if (isValid) {
    console.log("Planner output is valid");
  } else {
    console.log(`Found ${errors.length} planner errors and ${warnings.length} warnings`);
    issues.forEach((issue) => console.log(`${issue.severity}: ${issue.message}`));
  }

  return {
    plannerValidation: {
      isValid,
      issues,
      validationCycles: currentCycles + 1,
    },
    error: isValid || currentCycles + 1 < MAX_VALIDATION_CYCLES
      ? undefined
      : "plannerValidator failed: planner output does not match architect blueprint.",
  };
}

function addIssue(issues, type, severity, fixTarget, message) {
  issues.push({ type, severity, fixTarget, message });
}
