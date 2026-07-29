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

/*
  Main planner validator node.
*/
export function plannerValidatorNode(state) {
  console.log(
    "\n[Planner Validator] Checking core task plan\n"
  );

  const issues = [];
  const taskQueue = state.taskQueue || {};
  const blueprint = state.blueprint || {};

  validateTaskQueue(taskQueue, issues);
  validatePhaseOrder(taskQueue, issues);

  const tasks = collectAllTasks(taskQueue);

  validateTaskPaths(tasks, issues);

  const createdFiles = collectCreatedFiles(tasks);

  validateRequiredFiles(
    blueprint,
    createdFiles,
    issues
  );

  const folderStructure =
    blueprint.folderStructure || "";

  const blueprintFiles =
    extractFilesFromFolderStructure(folderStructure);

  validateBlueprintFileCoverage(
    blueprintFiles,
    createdFiles,
    issues
  );

  return finishValidation(state, issues);
}

export function plannerValidatorRouter(state) {
  const validation = state.plannerValidation;

  if (!validation) {
    return "plannerAgent";
  }

  if (validation.isValid) {
    return "setupSandbox";
  }

  if (
    validation.validationCycles >=
    MAX_VALIDATION_CYCLES
  ) {
    return "__end__";
  }

  return "plannerAgent";
}


export function blueprintRequiresAuth(blueprint = {}) {
  const endpoints = getList(
    blueprint.apiEndpoints
  );

  for (const endpoint of endpoints) {
    if (endpoint.requiresAuth === true) {
      return true;
    }
  }

  const frontendPages = getList(
    blueprint.frontendPages
  );

  for (const page of frontendPages) {
    if (page.requiresAuth === true) {
      return true;
    }
  }

  const folderStructure =
    blueprint.folderStructure || "";

  if (
    folderStructure.includes("AuthContext.jsx")
  ) {
    return true;
  }

  if (
    folderStructure.includes(
      "backend/src/middleware/auth.js"
    )
  ) {
    return true;
  }

  /*
    Check whether jsonwebtoken exists
  
  */
  if (
    blueprint.dependencies &&
    blueprint.dependencies.backend &&
    blueprint.dependencies.backend.dependencies &&
    blueprint.dependencies.backend.dependencies
      .jsonwebtoken
  ) {
    return true;
  }

  return false;
}

/*
  Validate the basic task queue structure.
*/
function validateTaskQueue(taskQueue, issues) {
  const phases = getList(taskQueue.phases);

  if (phases.length === 0) {
    addIssue(
      issues,
      "missing_phases",
      "Planner output must include phases."
    );

    return;
  }

  for (const phase of phases) {
    if (!(phase.tasks instanceof Array)) {
      addIssue(
        issues,
        "missing_phase_tasks",
        `Phase "${phase.phaseName || "unknown"}" must include a tasks array.`
      );

      continue;
    }

    if (phase.tasks.length === 0) {
      addIssue(
        issues,
        "empty_phase",
        `Phase "${phase.phaseName || "unknown"}" must contain at least one task.`
      );
    }

    for (const task of phase.tasks) {
      validateOneTask(task, phase, issues);
    }
  }
}

/*
  Validate one planner task.
*/
function validateOneTask(task, phase, issues) {
  if (!task.taskId) {
    addIssue(
      issues,
      "missing_task_id",
      `A task in phase "${phase.phaseName || "unknown"}" is missing taskId.`
    );
  }

  if (
    !(task.filesToCreate instanceof Array) ||
    task.filesToCreate.length === 0
  ) {
    addIssue(
      issues,
      "missing_files_to_create",
      `Task "${task.taskId || "unknown"}" must include filesToCreate.`
    );
  }

  if (!(task.filesNeeded instanceof Array)) {
    addIssue(
      issues,
      "missing_files_needed",
      `Task "${task.taskId || "unknown"}" must include filesNeeded.`
    );
  }

  if (
    typeof task.canParallelize !== "boolean"
  ) {
    addIssue(
      issues,
      "missing_parallel_flag",
      `Task "${task.taskId || "unknown"}" must include a boolean canParallelize value.`
    );
  }
}

/*
  Check that all seven phases appear
  in the correct order.
*/
function validatePhaseOrder(taskQueue, issues) {
  const phases = getList(taskQueue.phases);

  if (
    phases.length !== MANDATORY_PHASES.length
  ) {
    addIssue(
      issues,
      "invalid_phase_count",
      `Planner must return exactly ${MANDATORY_PHASES.length} phases.`
    );

    return;
  }

  for (
    let index = 0;
    index < MANDATORY_PHASES.length;
    index++
  ) {
    const phase = phases[index];
    const expectedName = MANDATORY_PHASES[index];
    const expectedNumber = index + 1;

    const actualName = normalizeText(
      phase.phaseName
    );

    if (actualName !== expectedName) {
      addIssue(
        issues,
        "invalid_phase_order",
        `Phase ${expectedNumber} must be "${expectedName}", but received "${phase.phaseName || "unknown"}".`
      );
    }

    if (
      phase.phaseNumber !== expectedNumber
    ) {
      addIssue(
        issues,
        "invalid_phase_number",
        `Phase "${phase.phaseName || "unknown"}" must have phaseNumber ${expectedNumber}.`
      );
    }
  }
}

/*
  Collect every task from every phase.
*/
function collectAllTasks(taskQueue) {
  const allTasks = [];
  const phases = getList(taskQueue.phases);

  for (const phase of phases) {
    const tasks = getList(phase.tasks);

    for (const task of tasks) {
      allTasks.push({
        taskId: task.taskId,
        filesToCreate: task.filesToCreate,
        filesNeeded: task.filesNeeded,
        canParallelize: task.canParallelize,
        phaseName: phase.phaseName,
      });
    }
  }

  return allTasks;
}

/*
  Validate every file path used by tasks.
*/
function validateTaskPaths(tasks, issues) {
  for (const task of tasks) {
    const filesToCreate = getList(
      task.filesToCreate
    );

    const filesNeeded = getList(
      task.filesNeeded
    );

    for (const filePath of filesToCreate) {
      validateOnePath(
        filePath,
        task.taskId,
        issues
      );
    }

    for (const filePath of filesNeeded) {
      validateOnePath(
        filePath,
        task.taskId,
        issues
      );
    }
  }
}

/*
  Validate one project file path.
*/
function validateOnePath(
  rawPath,
  taskId,
  issues
) {
  if (typeof rawPath !== "string") {
    addIssue(
      issues,
      "invalid_file_path",
      `Task "${taskId || "unknown"}" contains a file path that is not text.`
    );

    return;
  }

  const filePath = normalizeProjectPath(
    rawPath
  );

  if (!filePath) {
    addIssue(
      issues,
      "invalid_file_path",
      `Task "${taskId || "unknown"}" contains an empty file path.`
    );

    return;
  }

  if (
    filePath.startsWith("/") ||
    filePath.includes("..")
  ) {
    addIssue(
      issues,
      "unsafe_file_path",
      `Task "${taskId || "unknown"}" contains unsafe path "${rawPath}".`
    );

    return;
  }

  if (!isAllowedProjectPath(filePath)) {
    addIssue(
      issues,
      "unexpected_file_root",
      `Task "${taskId || "unknown"}" uses path "${rawPath}" outside backend, frontend, README.md, or .gitignore.`
    );
  }
}

/*
  Collect all files that planner tasks
  are supposed to create.
*/
function collectCreatedFiles(tasks) {
  const createdFiles = [];

  for (const task of tasks) {
    const files = getList(task.filesToCreate);

    for (const rawPath of files) {
      const filePath =
        normalizeProjectPath(rawPath);

      if (
        filePath &&
        !createdFiles.includes(filePath)
      ) {
        createdFiles.push(filePath);
      }
    }
  }

  return createdFiles;
}

/*
  Check core setup, auth, and documentation files.
*/
function validateRequiredFiles(
  blueprint,
  createdFiles,
  issues
) {
  validateFileList(
    REQUIRED_SETUP_FILES,
    createdFiles,
    "missing_setup_file",
    issues
  );

  validateFileList(
    REQUIRED_DOCUMENTATION_FILES,
    createdFiles,
    "missing_documentation_file",
    issues
  );

  if (blueprintRequiresAuth(blueprint)) {
    validateFileList(
      AUTH_SETUP_FILES,
      createdFiles,
      "missing_auth_file",
      issues
    );
  }
}

/*
  Check whether each required file exists
  in the planner task list.
*/
function validateFileList(
  requiredFiles,
  createdFiles,
  issueType,
  issues
) {
  for (const requiredFile of requiredFiles) {
    if (!createdFiles.includes(requiredFile)) {
      addIssue(
        issues,
        issueType,
        `Planner did not schedule required file "${requiredFile}".`
      );
    }
  }
}

/*
  Check that files shown by the architect
  are also scheduled by the planner.
*/
function validateBlueprintFileCoverage(
  blueprintFiles,
  createdFiles,
  issues
) {
  if (blueprintFiles.length === 0) {
    return;
  }

  for (const filePath of blueprintFiles) {
    if (!createdFiles.includes(filePath)) {
      addIssue(
        issues,
        "missing_architect_file_task",
        `Architect included "${filePath}", but planner did not schedule it.`
      );
    }
  }
}

/*
  Extract file paths from a folder tree.

  Example input:

  backend/
    src/
      index.js
*/
function extractFilesFromFolderStructure(
  folderStructure
) {
  const files = [];
  const folders = [];

  const lines = String(folderStructure).split(
    "\n"
  );

  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      continue;
    }

    const indentation =
      findContentPosition(rawLine);

    let name = removeTreeCharacters(rawLine);

    name = name.trim();

    if (name.startsWith("- ")) {
      name = name.slice(2).trim();
    }

    if (
      !name ||
      name === "." ||
      name === "/" ||
      normalizeText(name) === "root" ||
      normalizeText(name) === "project-root" ||
      normalizeText(name) === "project root"
    ) {
      continue;
    }

    while (
      folders.length > 0 &&
      folders[folders.length - 1].indent >=
        indentation
    ) {
      folders.pop();
    }

    let parentPath = "";

    if (folders.length > 0) {
      parentPath =
        folders[folders.length - 1].path;
    }

    const isFolder = name.endsWith("/");

    if (isFolder) {
      name = name.slice(0, -1);
    }

    let filePath;

    /*
      When the line already contains a complete path,
      use it directly.
    */
    if (name.includes("/") && !parentPath) {
      filePath = normalizeProjectPath(name);
    } else if (parentPath) {
      filePath = normalizeProjectPath(
        parentPath + "/" + name
      );
    } else {
      filePath = normalizeProjectPath(name);
    }

    if (isFolder) {
      folders.push({
        indent: indentation,
        path: filePath,
      });
    } else if (
      filePath &&
      !files.includes(filePath)
    ) {
      files.push(filePath);
    }
  }

  return files;
}

/*
  Find where the actual folder or file
  name begins on a tree line.
*/
function findContentPosition(line) {
  for (
    let index = 0;
    index < line.length;
    index++
  ) {
    const character = line[index];

    const isLetter =
      character >= "a" && character <= "z";

    const isCapitalLetter =
      character >= "A" && character <= "Z";

    const isNumber =
      character >= "0" && character <= "9";

    if (
      isLetter ||
      isCapitalLetter ||
      isNumber ||
      character === "."
    ) {
      return index;
    }
  }

  return 0;
}

/*
  Remove visual folder-tree characters.
*/
function removeTreeCharacters(line) {
  let result = line;

  result = result.split("│").join(" ");
  result = result.split("├").join(" ");
  result = result.split("└").join(" ");
  result = result.split("─").join(" ");

  return result;
}

/*
  Finish validation and return state update.
*/
function finishValidation(state, issues) {
  let previousCycles = 0;

  if (
    state.plannerValidation &&
    state.plannerValidation.validationCycles
  ) {
    previousCycles =
      state.plannerValidation.validationCycles;
  }

  const currentCycle = previousCycles + 1;
  const isValid = issues.length === 0;

  if (isValid) {
    console.log("Planner output is valid");
  } else {
    for (const problem of issues) {
      console.log(
        `${problem.severity}: ${problem.message}`
      );
    }
  }

  let error;

  if (
    !isValid &&
    currentCycle >= MAX_VALIDATION_CYCLES
  ) {
    error =
      "Planner validation failed because the task plan does not match the architect blueprint.";
  }

  return {
    plannerValidation: {
      isValid: isValid,
      issues: issues,
      validationCycles: currentCycle,
    },

    error: error,
  };
}

/*
  Only allow project files inside these locations.
*/
function isAllowedProjectPath(filePath) {
  if (filePath.startsWith("backend/")) {
    return true;
  }

  if (filePath.startsWith("frontend/")) {
    return true;
  }

  if (filePath === ".gitignore") {
    return true;
  }

  if (filePath === "README.md") {
    return true;
  }

  return false;
}

/*
  Clean a project path.
*/
function normalizeProjectPath(filePath) {
  if (
    filePath === undefined ||
    filePath === null
  ) {
    return "";
  }

  let cleanPath = String(filePath).trim();

  cleanPath = cleanPath
    .split("\\")
    .join("/");

  while (cleanPath.startsWith("./")) {
    cleanPath = cleanPath.slice(2);
  }

  const lowerPath = cleanPath.toLowerCase();

  if (lowerPath.startsWith("root/")) {
    cleanPath = cleanPath.slice(5);
  }

  if (lowerPath.startsWith("project/")) {
    cleanPath = cleanPath.slice(8);
  }

  return cleanPath;
}

/*
  Convert text to lowercase for comparison.
*/
function normalizeText(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim().toLowerCase();
}

/*
  Safely return an array.
*/
function getList(value) {
  if (value instanceof Array) {
    return value;
  }

  return [];
}

/*
  Add one planner validation error.
*/
function addIssue(issues, type, message) {
  issues.push({
    type: type,
    severity: "error",
    fixTarget: "plannerAgent",
    message: message,
  });
}