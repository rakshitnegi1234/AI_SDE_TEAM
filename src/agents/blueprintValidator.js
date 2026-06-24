const MAX_VALIDATION_CYCLES = 2;

export async function blueprintValidatorNode(state) {
  console.log("\n[Blueprint Validator] Cross-validating architecture\n");

  const blueprint = state.blueprint || {};
  const issues = [];

  checkEntityTables(blueprint, issues);
  checkForeignKeys(blueprint, issues);
  checkApiTables(blueprint, issues);
  checkFrontendApiCalls(blueprint, issues);
  checkAuthConsistency(blueprint, issues);
  checkOrphanTables(blueprint, issues);

  const hasCoreErrors = issues.some((issue) => issue.severity === "error");

  if (!hasCoreErrors) {
    checkFolderStructure(blueprint, issues);
    checkDependencies(blueprint, issues);
  }

  return buildValidationResult(state, issues);
}

export function blueprintValidatorRouter(state) {
  const validation = state.blueprintValidation;

  if (validation?.isValid) {
    return "__end__";
  }

  const issues = validation?.issues || [];
  const errors = issues.filter((issue) => issue.severity === "error");
  const target = errors[0]?.fixTarget || mostCommonFixTarget(issues);

  if (!target) {
    return "__end__";
  }

  console.log(`Routing back to ${target} for fixes\n`);
  return target;
}




function checkEntityTables(blueprint, issues) {
  const entities = blueprint.entities || [];
  const tables = blueprint.dbSchema?.tables || [];
  const tableNames = new Set(tables.map((table) => table.name?.toLowerCase()));

  for (const entity of entities) {
    const expectedTable = entity.tableName?.toLowerCase();
    const fallbackTable = toSnakePlural(entity.name);

    if (!tableNames.has(expectedTable || fallbackTable)) {
      issues.push({
        type: "missing_table",
        severity: "error",
        fixTarget: "architectStep2",
        message: `Entity "${entity.name}" expects table "${expectedTable || fallbackTable}", but it was not found.`,
      });
    }
  }
}

function checkForeignKeys(blueprint, issues) {
  const tables = blueprint.dbSchema?.tables || [];
  const tableNames = new Set(tables.map((table) => table.name?.toLowerCase()));

  for (const table of tables) {
    for (const foreignKey of table.foreignKeys || []) {
      const referencedTable = getForeignKeyTable(foreignKey.references);

      if (referencedTable && !tableNames.has(referencedTable)) {
        issues.push({
          type: "invalid_foreign_key",
          severity: "error",
          fixTarget: "architectStep2",
          message: `Table "${table.name}" references "${foreignKey.references}", but table "${referencedTable}" does not exist.`,
        });
      }
    }
  }
}

function checkApiTables(blueprint, issues) {
  const endpoints = blueprint.apiEndpoints || [];
  const tableNames = new Set((blueprint.dbSchema?.tables || []).map((table) => table.name?.toLowerCase()));

  for (const endpoint of endpoints) {
    if (!endpoint.relatedTable) continue;

    if (endpoint.relatedTable.includes(",")) {
      issues.push({
        type: "invalid_related_table",
        severity: "error",
        fixTarget: "architectStep3",
        message: `API "${endpoint.method} ${endpoint.path}" must use one relatedTable, not "${endpoint.relatedTable}".`,
      });
      continue;
    }

    const relatedTable = endpoint.relatedTable.toLowerCase();

    if (!tableNames.has(relatedTable)) {
      issues.push({
        type: "orphan_endpoint",
        severity: "error",
        fixTarget: "architectStep3",
        message: `API "${endpoint.method} ${endpoint.path}" references table "${relatedTable}", but that table does not exist.`,
      });
    }
  }
}

function checkFrontendApiCalls(blueprint, issues) {

  const frontendPages = blueprint.frontendPages || [];
  const apiEndpoints = blueprint.apiEndpoints || [];

  for (const page of frontendPages) {
    for (const component of page.components || []) {
      for (const apiCall of component.apiCalls || []) {
        if (!hasMatchingEndpoint(apiCall, apiEndpoints)) {
          issues.push({
            type: "missing_api",
            severity: "warning",
            fixTarget: "architectStep3",
            message: `Page "${page.name}" component "${component.name}" calls "${apiCall}", but no matching API endpoint exists.`,
          });
        }
      }
    }
  }
}

function checkAuthConsistency(blueprint, issues) {
  const frontendPages = blueprint.frontendPages || [];
  const protectedEndpoints = (blueprint.apiEndpoints || []).filter((endpoint) => endpoint.requiresAuth);

  for (const page of frontendPages) {
    for (const component of page.components || []) {
      const callsProtectedApi = (component.apiCalls || []).some((apiCall) =>
        hasMatchingEndpoint(apiCall, protectedEndpoints)
      );

      if (callsProtectedApi && !page.requiresAuth) {
        issues.push({
          type: "auth_mismatch",
          severity: "warning",
          fixTarget: "architectStep4",
          message: `Page "${page.name}" calls an auth-required API but page.requiresAuth is false.`,
        });
      }
    }
  }
}

function checkOrphanTables(blueprint, issues) {
  const tables = blueprint.dbSchema?.tables || [];
  const entityTables = new Set((blueprint.entities || []).map((entity) => entity.tableName?.toLowerCase()).filter(Boolean));
  const referencedTables = new Set(
    (blueprint.apiEndpoints || [])
      .map((endpoint) => endpoint.relatedTable?.toLowerCase())
      .filter(Boolean)
  );

  for (const table of tables) {
    const tableName = table.name?.toLowerCase();

    if (!referencedTables.has(tableName) && !isJoinTable(table, entityTables)) {
      issues.push({
        type: "orphan_table",
        severity: "warning",
        fixTarget: "architectStep3",
        message: `Table "${table.name}" exists but no API endpoint references it.`,
      });
    }
  }
}

function checkFolderStructure(blueprint, issues) {
  const folderStructure = blueprint.folderStructure || "";
  const requiredEntries = [
    "backend/",
    "frontend/",
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
  ];

  for (const entry of requiredEntries) {
    if (!folderStructure.includes(entry)) {
      issues.push({
        type: "missing_folder_entry",
        severity: "warning",
        fixTarget: "architectStep5",
        message: `Folder structure is missing "${entry}".`,
      });
    }
  }
}

function checkDependencies(blueprint, issues) {
  const dependencies = blueprint.dependencies || {};
  const backendDeps = dependencies.backend?.dependencies || {};
  const backendDevDeps = dependencies.backend?.devDependencies || {};
  const frontendDeps = dependencies.frontend?.dependencies || {};
  const frontendDevDeps = dependencies.frontend?.devDependencies || {};

  requirePackages(backendDeps, {
    express: "^4.18.2",
    cors: "^2.8.5",
    dotenv: "^16.4.7",
    bcryptjs: "^2.4.3",
    jsonwebtoken: "^9.0.2",
    uuid: "^9.0.0",
  }, "backend dependency", "architectStep5", issues);

  requirePackages(backendDevDeps, {
    nodemon: "^3.0.0",
  }, "backend devDependency", "architectStep5", issues);

  requirePackages(frontendDeps, {
    react: "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    axios: "^1.6.0",
  }, "frontend dependency", "architectStep5", issues);

  requirePackages(frontendDevDeps, {
    vite: "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    tailwindcss: "^3.4.0",
    postcss: "^8.4.0",
    autoprefixer: "^10.4.0",
  }, "frontend devDependency", "architectStep5", issues);

  checkDatabasePackage(blueprint.dbSchema?.databaseType, backendDeps, issues);
}

function checkDatabasePackage(databaseType = "", backendDeps, issues) {
  const normalizedType = databaseType.toLowerCase();

  if (normalizedType === "postgresql") {
    requirePackages(backendDeps, { pg: "^8.11.0" }, "backend dependency", "architectStep5", issues);

    if (backendDeps.mongoose) {
      issues.push({
        type: "wrong_database_dependency",
        severity: "warning",
        fixTarget: "architectStep5",
        message: "PostgreSQL projects should not include mongoose unless both databases are required.",
      });
    }
  }

  if (normalizedType === "mongodb") {
    requirePackages(backendDeps, { mongoose: "^8.8.0" }, "backend dependency", "architectStep5", issues);

    if (backendDeps.pg) {
      issues.push({
        type: "wrong_database_dependency",
        severity: "warning",
        fixTarget: "architectStep5",
        message: "MongoDB projects should not include pg unless both databases are required.",
      });
    }
  }
}

function requirePackages(actualPackages, expectedPackages, packageType, fixTarget, issues) {
  for (const [name, version] of Object.entries(expectedPackages)) {
    if (actualPackages[name] !== version) {
      issues.push({
        type: "missing_dependency",
        severity: "warning",
        fixTarget,
        message: `Expected ${packageType} "${name}" at version "${version}".`,
      });
    }
  }
}

function buildValidationResult(state, issues) {
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
      currentPhase: "planner",
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
      currentPhase: "planner",
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

function hasMatchingEndpoint(apiCall, endpoints) {
  const call = parseApiCall(apiCall);

  return endpoints.some((endpoint) => {
    const endpointPath = normalizeApiPath(endpoint.path);
    const samePath = endpointPath === call.path;
    const sameMethod = !call.method || endpoint.method?.toLowerCase() === call.method;

    return samePath && sameMethod;
  });
}

function parseApiCall(apiCall = "") {
  const value = String(apiCall).trim().toLowerCase();
  const match = value.match(/^(get|post|put|patch|delete)\s+(.+)$/);

  if (!match) {
    return {
      method: "",
      path: normalizeApiPath(value),
    };
  }

  return {
    method: match[1],
    path: normalizeApiPath(match[2]),
  };
}

function normalizeApiPath(apiPath = "") {
  return String(apiPath)
    .trim()
    .toLowerCase()
    .replace(/\/:\w+/g, "/:param");
}

function getForeignKeyTable(reference = "") {
  const match = reference.match(/^(\w+)\(/);
  return match?.[1]?.toLowerCase() || "";
}

function isJoinTable(table, entityTables) {
  const tableName = table.name?.toLowerCase() || "";
  return !entityTables.has(tableName) && tableName.includes("_") && (table.foreignKeys || []).length >= 2;
}

function toSnakePlural(name = "") {
  const snakeName = name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();

  if (snakeName.endsWith("y")) {
    return `${snakeName.slice(0, -1)}ies`;
  }

  return snakeName.endsWith("s") ? snakeName : `${snakeName}s`;
}

function mostCommonFixTarget(issues) {
  const counts = {};

  for (const issue of issues) {
    if (!issue.fixTarget) continue;
    counts[issue.fixTarget] = (counts[issue.fixTarget] || 0) + 1;
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}
