const MAX_VALIDATION_CYCLES = 2;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

const REQUIRED_BACKEND_FILES = [
  "backend/",
  "package.json",
  ".env.example",
  "server.js",
  "app.js",
  "config/",
  "models/",
  "routes/",
  "controllers/",
  "middleware/",
  "utils/",
];

const REQUIRED_FRONTEND_FILES = [
  "frontend/",
  "package.json",
  "index.html",
  "vite.config.js",
  "tailwind.config.js",
  "postcss.config.js",
  "main.jsx",
  "App.jsx",
  "pages/",
  "components/",
  "context/",
  "hooks/",
  "utils/",
];

const REQUIRED_BACKEND_DEPENDENCIES = [
  ["express", "^4.18.2"],
  ["cors", "^2.8.5"],
  ["dotenv", "^16.4.7"],
  ["bcryptjs", "^2.4.3"],
  ["jsonwebtoken", "^9.0.2"],
  ["uuid", "^9.0.0"],
];

const REQUIRED_FRONTEND_DEPENDENCIES = [
  ["react", "^18.2.0"],
  ["react-dom", "^18.2.0"],
  ["react-router-dom", "^6.20.0"],
  ["axios", "^1.6.0"],
];

const REQUIRED_FRONTEND_DEV_DEPENDENCIES = [
  ["vite", "^5.0.0"],
  ["@vitejs/plugin-react", "^4.2.0"],
  ["tailwindcss", "^3.4.0"],
  ["postcss", "^8.4.0"],
  ["autoprefixer", "^10.4.0"],
];

const CORE_BLUEPRINT_CHECKS = [
  validateEntityTables,
  validateForeignKeys,
  validateApiTables,
  validateFrontendApiCalls,
  validateAuthRules,
  validateUnusedTables,
];

const PROJECT_SETUP_CHECKS = [
  validateProjectStructure,
  validateDependencies,
];


export async function blueprintValidatorNode(state) {
  console.log("\n[Blueprint Validator] Checking full architecture blueprint\n");

  const blueprint = state.blueprint || {};
  const issues = [];

  // First validate the actual architecture: entities, tables, APIs, and pages.
  // If these are broken, folder/dependency feedback would only add noise.
  
  runChecks(CORE_BLUEPRINT_CHECKS, blueprint, issues);

  if (!hasErrors(issues)) {
    runChecks(PROJECT_SETUP_CHECKS, blueprint, issues);
  }

  return finishValidation(state, issues);
}

export function blueprintValidatorRouter(state) {
  const validation = state.blueprintValidation;

  if (validation?.isValid) {
    return "__end__";
  }

  const issues = validation?.issues || [];
  const firstError = issues.find((issue) => issue.severity === "error");
  const route = firstError?.fixTarget || findMostCommonFixTarget(issues);

  if (!route) {
    return "__end__";
  }

  console.log(`Routing back to ${route} for fixes\n`);
  return route;
}












function validateEntityTables(blueprint, issues) {
  const tables = blueprint.dbSchema?.tables || [];
  const tableNames = tables.map((table) => normalizeName(table.name));

  for (const entity of blueprint.entities || []) {
    if (!entity.tableName) {
      addIssue(issues, "missing_entity_table_name", "error", "architectStep1",
        `Entity "${entity.name}" does not define tableName.`);
      continue;
    }

    if (!tableNames.includes(normalizeName(entity.tableName))) {
      addIssue(issues, "missing_table", "error", "architectStep2",
        `Entity "${entity.name}" expects table "${entity.tableName}", but that table was not found.`);
    }
  }
}

function validateForeignKeys(blueprint, issues) {
  const tables = blueprint.dbSchema?.tables || [];
  const tableNames = tables.map((table) => normalizeName(table.name));

  for (const table of tables) {
    for (const foreignKey of table.foreignKeys || []) {
      const referencedTable = readReferencedTable(foreignKey.references);

      if (referencedTable && !tableNames.includes(referencedTable)) {
        addIssue(issues, "invalid_foreign_key", "error", "architectStep2",
          `Table "${table.name}" references "${foreignKey.references}", but table "${referencedTable}" does not exist.`);
      }
    }
  }
}

function validateApiTables(blueprint, issues) {
  const tables = blueprint.dbSchema?.tables || [];
  const tableNames = tables.map((table) => normalizeName(table.name));

  for (const endpoint of blueprint.apiEndpoints || []) {
    if (!endpoint.relatedTable) continue;

    if (endpoint.relatedTable.includes(",")) {
      addIssue(issues, "invalid_related_table", "error", "architectStep3",
        `API "${endpoint.method} ${endpoint.path}" should use one relatedTable, not "${endpoint.relatedTable}".`);
      continue;
    }

    const relatedTable = normalizeName(endpoint.relatedTable);

    if (!tableNames.includes(relatedTable)) {
      addIssue(issues, "orphan_endpoint", "error", "architectStep3",
        `API "${endpoint.method} ${endpoint.path}" references table "${endpoint.relatedTable}", but that table does not exist.`);
    }
  }
}

function validateFrontendApiCalls(blueprint, issues) {
  const endpoints = blueprint.apiEndpoints || [];

  for (const page of blueprint.frontendPages || []) {
    for (const component of page.components || []) {
      for (const apiCall of component.apiCalls || []) {
        if (!apiCallMatchesEndpoint(apiCall, endpoints)) {
          addIssue(issues, "missing_api", "warning", "architectStep3",
            `Page "${page.name}" component "${component.name}" calls "${apiCall}", but no matching API endpoint exists.`);
        }
      }
    }
  }
}

function validateAuthRules(blueprint, issues) {
  const protectedEndpoints = (blueprint.apiEndpoints || []).filter((endpoint) => endpoint.requiresAuth);

  for (const page of blueprint.frontendPages || []) {
    for (const component of page.components || []) {
      const callsProtectedApi = (component.apiCalls || []).some((apiCall) =>
        apiCallMatchesEndpoint(apiCall, protectedEndpoints)
      );

      if (callsProtectedApi && !page.requiresAuth) {
        addIssue(issues, "auth_mismatch", "warning", "architectStep4",
          `Page "${page.name}" calls an auth-required API but page.requiresAuth is false.`);
      }
    }
  }
}

function validateUnusedTables(blueprint, issues) {
  const entityTableNames = (blueprint.entities || [])
    .map((entity) => normalizeName(entity.tableName))
    .filter(Boolean);

  const apiTableNames = (blueprint.apiEndpoints || [])
    .map((endpoint) => normalizeName(endpoint.relatedTable))
    .filter(Boolean);

  for (const table of blueprint.dbSchema?.tables || []) {
    const tableName = normalizeName(table.name);

    if (apiTableNames.includes(tableName)) continue;
    if (isJoinTable(table, entityTableNames)) continue;

    addIssue(issues, "orphan_table", "warning", "architectStep3",
      `Table "${table.name}" exists but no API endpoint references it.`);
  }
}

function validateProjectStructure(blueprint, issues) {
  const folderStructure = blueprint.folderStructure || "";
  const requiredFiles = [...REQUIRED_BACKEND_FILES, ...REQUIRED_FRONTEND_FILES];

  for (const filePath of requiredFiles) {
    if (!folderStructure.includes(filePath)) {
      addIssue(issues, "missing_folder_entry", "warning", "architectStep5",
        `Folder structure is missing "${filePath}".`);
    }
  }
}

function validateDependencies(blueprint, issues) {
  const backend = blueprint.dependencies?.backend || {};
  const frontend = blueprint.dependencies?.frontend || {};

  checkPackages(backend.dependencies || {}, REQUIRED_BACKEND_DEPENDENCIES, "backend dependency", issues);
  checkPackages(backend.devDependencies || {}, [["nodemon", "^3.0.0"]], "backend devDependency", issues);
  checkPackages(frontend.dependencies || {}, REQUIRED_FRONTEND_DEPENDENCIES, "frontend dependency", issues);
  checkPackages(frontend.devDependencies || {}, REQUIRED_FRONTEND_DEV_DEPENDENCIES, "frontend devDependency", issues);

  const databaseType = normalizeName(blueprint.dbSchema?.databaseType);

  if (databaseType === "postgresql") {
    checkPackages(backend.dependencies || {}, [["pg", "^8.11.0"]], "backend dependency", issues);

    if (backend.dependencies?.mongoose) {
      addIssue(issues, "wrong_database_dependency", "warning", "architectStep5",
        "PostgreSQL projects should not include mongoose unless both databases are required.");
    }
  }

  if (databaseType === "mongodb") {
    checkPackages(backend.dependencies || {}, [["mongoose", "^8.8.0"]], "backend dependency", issues);

    if (backend.dependencies?.pg) {
      addIssue(issues, "wrong_database_dependency", "warning", "architectStep5",
        "MongoDB projects should not include pg unless both databases are required.");
    }
  }
}

function checkPackages(actualPackages, requiredPackages, label, issues) {
  for (const [packageName, expectedVersion] of requiredPackages) {
    const actualVersion = actualPackages[packageName];

    if (!actualVersion) {
      addIssue(issues, "missing_dependency", "warning", "architectStep5",
        `Missing ${label} "${packageName}".`);
      continue;
    }

    const actualMajor = readMajorVersion(actualVersion);
    const expectedMajor = readMajorVersion(expectedVersion);

    if (actualMajor !== null && expectedMajor !== null && actualMajor !== expectedMajor) {
      addIssue(issues, "dependency_major_mismatch", "warning", "architectStep5",
        `Expected ${label} "${packageName}" to use major version ${expectedMajor}, but found "${actualVersion}".`);
    }
  }
}

function runChecks(checks, blueprint, issues) {
  for (const check of checks) {
    check(blueprint, issues);
  }
}

function hasErrors(issues) {
  return issues.some((issue) => issue.severity === "error");
}

function readMajorVersion(version) {
  const match = String(version).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function finishValidation(state, issues) {
  const currentCycles = state.blueprintValidation?.validationCycles || 0;
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  if (issues.length === 0) {
    console.log("Blueprint is valid");
    return {
      blueprintValidation: {
        isValid: true,
        issues: [],
        validationCycles: currentCycles + 1,
      },
    };
  }

  console.log(`Found ${errors.length} errors and ${warnings.length} warnings`);
  issues.forEach((issue) => console.log(`${issue.severity}: ${issue.message}`));

  if (currentCycles >= MAX_VALIDATION_CYCLES) {
    console.log("Max validation cycles reached. Proceeding with warnings.");
    return {
      blueprintValidation: {
        isValid: true,
        issues,
        validationCycles: currentCycles + 1,
      },
    };
  }

  return {
    blueprintValidation: {
      isValid: false,
      issues,
      validationCycles: currentCycles + 1,
    },
  };
}

function apiCallMatchesEndpoint(apiCall, endpoints) {
  const call = splitApiCall(apiCall);

  return endpoints.some((endpoint) => {
    const endpointPath = cleanApiPath(endpoint.path);
    const endpointMethod = normalizeName(endpoint.method);

    return endpointPath === call.path && (!call.method || endpointMethod === call.method);
  });
}

function splitApiCall(apiCall = "") {
  const parts = String(apiCall).trim().toLowerCase().split(" ").filter(Boolean);
  const firstPart = parts[0] || "";

  if (HTTP_METHODS.includes(firstPart)) {
    return {
      method: firstPart,
      path: cleanApiPath(parts.slice(1).join(" ")),
    };
  }

  return {
    method: "",
    path: cleanApiPath(parts.join(" ")),
  };
}

function cleanApiPath(apiPath = "") {
  return String(apiPath)
    .trim()
    .toLowerCase()
    .split("/")
    .map((part) => part.startsWith(":") ? ":param" : part)
    .join("/");
}

function readReferencedTable(reference = "") {
  const openingParenthesis = reference.indexOf("(");

  if (openingParenthesis === -1) {
    return "";
  }

  return normalizeName(reference.slice(0, openingParenthesis));
}

function isJoinTable(table, entityTableNames) {
  const tableName = normalizeName(table.name);
  const foreignKeys = table.foreignKeys || [];

  return !entityTableNames.includes(tableName) && tableName.includes("_") && foreignKeys.length >= 2;
}

function addIssue(issues, type, severity, fixTarget, message) {
  issues.push({ type, severity, fixTarget, message });
}

function normalizeName(value = "") {
  return String(value).trim().toLowerCase();
}

function findMostCommonFixTarget(issues) {
  const counts = {};
  let bestTarget = "";
  let bestCount = 0;

  for (const issue of issues) {
    if (!issue.fixTarget) continue;

    counts[issue.fixTarget] = (counts[issue.fixTarget] || 0) + 1;

    if (counts[issue.fixTarget] > bestCount) {
      bestTarget = issue.fixTarget;
      bestCount = counts[issue.fixTarget];
    }
  }

  return bestTarget;
}
