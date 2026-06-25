const MAX_VALIDATION_CYCLES = 2;

export function plannerValidatorNode(state) {
  console.log("\n[Planner Validator] Checking planner output against blueprint\n");

  const issues = [];
  const blueprint = state.blueprint || {};
  const taskQueue = state.taskQueue || {};
  const createdFiles = collectCreatedFiles(taskQueue, issues);
  const architectFiles = extractFilesFromFolderStructure(blueprint.folderStructure || "");

  validateTaskQueueShape(taskQueue, issues);
  validatePathRules(taskQueue, issues);
  validateDuplicateCreation(taskQueue, issues);
  validateDependencyOrder(taskQueue, issues);
  validateEntityFileNames(blueprint.entities || [], createdFiles, issues);
  validateFolderStructureCoverage(architectFiles, createdFiles, issues);

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

function validateTaskQueueShape(taskQueue, issues) {
  if (!Array.isArray(taskQueue.phases) || taskQueue.phases.length === 0) {
    addIssue(issues, "missing_phases", "error", "plannerAgent",
      "Planner output must include a non-empty phases array.");
    return;
  }

  for (const phase of taskQueue.phases) {
    if (!Array.isArray(phase.tasks) || phase.tasks.length === 0) {
      addIssue(issues, "missing_phase_tasks", "error", "plannerAgent",
        `Phase "${phase.phaseName || phase.phaseNumber || "unknown"}" must include tasks.`);
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
        addIssue(issues, "missing_files_needed", "warning", "plannerAgent",
          `Task "${task.taskId || "unknown"}" should include filesNeeded, even when empty.`);
      }
    }
  }
}

function validatePathRules(taskQueue, issues) {
  for (const task of allTasks(taskQueue)) {
    for (const filePath of [...(task.filesToCreate || []), ...(task.filesNeeded || [])]) {
      if (typeof filePath !== "string" || filePath.trim() === "") {
        addIssue(issues, "invalid_file_path", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" contains an invalid file path.`);
        continue;
      }

      if (filePath.startsWith("/") || filePath.includes("..")) {
        addIssue(issues, "unsafe_file_path", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" uses unsafe path "${filePath}". Paths must be project-relative.`);
      }

      if (!filePath.startsWith("backend/") && !filePath.startsWith("frontend/") && filePath !== ".gitignore" && filePath !== "README.md") {
        addIssue(issues, "unexpected_file_root", "warning", "plannerAgent",
          `Task "${task.taskId || "unknown"}" uses path "${filePath}" outside expected project roots.`);
      }
    }
  }
}

function validateDuplicateCreation(taskQueue, issues) {
  const firstCreation = new Map();

  for (const task of allTasks(taskQueue)) {
    for (const filePath of task.filesToCreate || []) {
      if (!firstCreation.has(filePath)) {
        firstCreation.set(filePath, task);
        continue;
      }

      if (!isAllowedIntegrationUpdate(task, filePath)) {
        addIssue(issues, "duplicate_file_creation", "error", "plannerAgent",
          `File "${filePath}" appears in filesToCreate more than once outside an allowed integration update.`);
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
      if (!createdSoFar.has(filePath)) {
        addIssue(issues, "future_or_missing_dependency", "error", "plannerAgent",
          `Task "${task.taskId || "unknown"}" needs "${filePath}" before any earlier task creates it.`);
      }
    }

    for (const filePath of task.filesToCreate || []) {
      createdSoFar.add(filePath);
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

function collectCreatedFiles(taskQueue, issues) {
  const files = [];

  for (const task of allTasks(taskQueue)) {
    for (const filePath of task.filesToCreate || []) {
      files.push(filePath);
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

function extractFilesFromFolderStructure(folderStructure) {
  const files = [];
  const stack = [];

  for (const rawLine of String(folderStructure).split("\n")) {
    if (!rawLine.trim()) continue;

    const firstPathChar = rawLine.search(/[A-Za-z0-9_.]/);
    const indent = firstPathChar === -1 ? 0 : firstPathChar;
    const name = cleanTreeLine(rawLine);

    if (!name || name === "." || name === "/") continue;

    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const explicitPath = name.includes("/") && !name.endsWith("/")
      ? name.replace(/\/$/, "")
      : "";
    const parentPath = stack.length ? stack[stack.length - 1].path : "";
    const path = explicitPath || joinPath(parentPath, name.replace(/\/$/, ""));

    if (name.endsWith("/")) {
      stack.push({ indent, path });
      continue;
    }

    files.push(path);
  }

  return Array.from(new Set(files));
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
