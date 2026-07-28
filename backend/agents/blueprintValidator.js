const MAX_VALIDATION_CYCLES = 3;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

const REQUIRED_BACKEND_PATHS = [
  "backend/",
  "backend/package.json",
  "backend/.env.example",
  "backend/src/",
  "backend/src/index.js",
  "backend/src/config/",
  "backend/src/config/db.js",
  "backend/src/models/",
  "backend/src/routes/",
  "backend/src/controllers/",
  "backend/src/middleware/",
  "backend/src/utils/",
];

const REQUIRED_FRONTEND_PATHS = [
  "frontend/",
  "frontend/package.json",
  "frontend/.env.example",
  "frontend/index.html",
  "frontend/vite.config.js",
  "frontend/tailwind.config.js",
  "frontend/postcss.config.js",
  "frontend/src/",
  "frontend/src/main.jsx",
  "frontend/src/App.jsx",
  "frontend/src/index.css",
  "frontend/src/pages/",
  "frontend/src/components/",
  "frontend/src/context/",
  "frontend/src/hooks/",
  "frontend/src/utils/",
];

const REQUIRED_BACKEND_DEPENDENCIES = [
  ["express", "^4.18.2"],
  ["cors", "^2.8.5"],
  ["dotenv", "^16.4.7"],
  ["uuid", "^9.0.0"],
];

const REQUIRED_AUTH_BACKEND_DEPENDENCIES = [
  ["bcryptjs", "^2.4.3"],
  ["jsonwebtoken", "^9.0.2"],
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

export async function blueprintValidatorNode(state) {
  
  console.log("\n[Blueprint Validator] Checking full architecture blueprint\n");

  const blueprint = state.blueprint || {};
  const clarifiedSpec = state.clarifiedSpec || {};
  const issues = [];

  validateCoreBlueprint(blueprint, clarifiedSpec, issues);

  if (!hasErrors(issues)) {
    validateProjectSetup(blueprint, clarifiedSpec, issues);
  }

  return finishValidation(state, issues);
}

export function blueprintValidatorRouter(state) {
  const validation = state.blueprintValidation;

  if (validation?.isValid) {
    return "__end__";
  }

  if ((validation?.validationCycles || 0) >= MAX_VALIDATION_CYCLES) {
    return "__failed__";
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


function validateCoreBlueprint(blueprint, clarifiedSpec, issues) {
  validateSpecBlueprintAlignment(blueprint, clarifiedSpec, issues);
  validateEntityNamingContracts(blueprint, issues);
  validateEntityRelationshipContracts(blueprint, issues);
  validateEntityTables(blueprint, issues);
  validateDatabaseSchemaContracts(blueprint, clarifiedSpec, issues);
  validateForeignKeys(blueprint, issues);
  validateApiEndpointContracts(blueprint, issues);
  validateApiCrudCoverage(blueprint, issues);
  validateApiTables(blueprint, issues);
  validateFrontendContracts(blueprint, issues);
  validateFrontendApiCalls(blueprint, issues);
  validateAuthRules(blueprint, issues);
  validateUnusedTables(blueprint, issues);
}

function validateSpecBlueprintAlignment(blueprint, clarifiedSpec, issues) {
  if (!clarifiedSpec || Object.keys(clarifiedSpec).length === 0) {
    return;
  }

  validateDatabaseRecommendation(blueprint, clarifiedSpec, issues);
  validateAuthCoverage(blueprint, clarifiedSpec, issues);
  validateSpecPages(blueprint, clarifiedSpec, issues);
  validateRoleAccess(blueprint, clarifiedSpec, issues);
}

function validateDatabaseRecommendation(blueprint, clarifiedSpec, issues) {
  const expectedDatabase = normalizeName(clarifiedSpec.databaseRecommendation);
  const actualDatabase = normalizeName(blueprint.dbSchema?.databaseType);

  if (!expectedDatabase || !actualDatabase) {
    return;
  }

  if (expectedDatabase !== actualDatabase) {
    addIssue(issues, "database_mismatch", "error", "architectStep2",
      `PM spec recommends "${clarifiedSpec.databaseRecommendation}", but dbSchema.databaseType is "${blueprint.dbSchema?.databaseType}".`);
  }
}

function validateAuthCoverage(blueprint, clarifiedSpec, issues) {
  if (!clarifiedSpec.authRequired) {
    return;
  }

  const hasUserEntity = (blueprint.entities || []).some((entity) =>
    normalizeName(entity.name) === "user" || normalizeName(entity.tableName) === "users"
  );

  if (!hasUserEntity) {
    addIssue(issues, "missing_user_entity", "error", "architectStep1",
      "PM spec requires authentication, but the blueprint does not include a User entity.");
  }

  const endpoints = blueprint.apiEndpoints || [];
  const hasRegisterEndpoint = endpoints.some((endpoint) =>
    endpointMatches(endpoint, "post", "/api/v1/auth/register")
  );
  const hasLoginEndpoint = endpoints.some((endpoint) =>
    endpointMatches(endpoint, "post", "/api/v1/auth/login")
  );

  if (!hasRegisterEndpoint) {
    addIssue(issues, "missing_register_endpoint", "error", "architectStep3",
      "PM spec requires authentication, but POST /api/v1/auth/register is missing.");
  }

  if (!hasLoginEndpoint) {
    addIssue(issues, "missing_login_endpoint", "error", "architectStep3",
      "PM spec requires authentication, but POST /api/v1/auth/login is missing.");
  }
}

function validateSpecPages(blueprint, clarifiedSpec, issues) {
  const blueprintRoutes = new Set(
    (blueprint.frontendPages || [])
      .map((page) => normalizeRoute(page.route))
      .filter(Boolean)
  );

  for (const page of clarifiedSpec.pages || []) {
    const route = normalizeRoute(page.route);
    if (!route) continue;

    if (!blueprintRoutes.has(route)) {
      addIssue(issues, "missing_spec_page", "error", "architectStep4",
        `PM spec requires page route "${page.route}", but frontendPages does not include it.`);
    }
  }
}

function validateRoleAccess(blueprint, clarifiedSpec, issues) {
  const validRoles = new Set(
    (clarifiedSpec.userRoles || [])
      .map((role) => normalizeName(role))
      .filter(Boolean)
  );

  if (validRoles.size === 0) {
    return;
  }

  for (const endpoint of blueprint.apiEndpoints || []) {
    for (const role of endpoint.roleAccess || []) {
      const normalizedRole = normalizeName(role);

      if (!validRoles.has(normalizedRole)) {
        addIssue(issues, "unknown_endpoint_role", "error", "architectStep3",
          `API "${endpoint.method} ${endpoint.path}" uses role "${role}", but PM spec roles are: ${Array.from(validRoles).join(", ")}.`);
      }
    }
  }
}

function validateProjectSetup(blueprint, clarifiedSpec, issues) {
  validateProjectStructure(blueprint, clarifiedSpec, issues);
  validateDependencies(blueprint, clarifiedSpec, issues);
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

function validateEntityNamingContracts(blueprint, issues) {
  const entities = blueprint.entities || [];

  if (!Array.isArray(blueprint.entities) || blueprint.entities.length === 0) {
    addIssue(issues, "missing_entities", "error", "architectStep1",
      "blueprint.entities must be a non-empty array.");
    return;
  }

  checkUniqueValues(
    entities,
    (entity) => entity.name,
    "duplicate_entity_name",
    "architectStep1",
    "Entity names must be unique.",
    issues
  );
  checkUniqueValues(
    entities,
    (entity) => entity.tableName,
    "duplicate_table_name",
    "architectStep1",
    "Entity tableName values must be unique.",
    issues
  );
  checkUniqueValues(
    entities,
    (entity) => entity.apiPath,
    "duplicate_entity_api_path",
    "architectStep1",
    "Entity apiPath values must be unique.",
    issues
  );
  checkUniqueValues(
    entities,
    (entity) => entity.modelFile,
    "duplicate_model_file",
    "architectStep1",
    "Entity modelFile values must be unique.",
    issues
  );
  checkUniqueValues(
    entities,
    (entity) => entity.routeFile,
    "duplicate_route_file",
    "architectStep1",
    "Entity routeFile values must be unique.",
    issues
  );

  for (const entity of entities) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(entity.name || "")) {
      addIssue(issues, "invalid_entity_name", "error", "architectStep1",
        `Entity name "${entity.name || ""}" must be PascalCase singular.`);
    }

    if (entity.tableName && !/^[a-z][a-z0-9_]*$/.test(entity.tableName)) {
      addIssue(issues, "invalid_table_name", "error", "architectStep1",
        `Entity "${entity.name}" tableName "${entity.tableName}" must be snake_case.`);
    }

    if (entity.apiPath && !/^\/api\/v1\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entity.apiPath)) {
      addIssue(issues, "invalid_api_path", "error", "architectStep1",
        `Entity "${entity.name}" apiPath "${entity.apiPath}" must use /api/v1/ with kebab-case resource names.`);
    }

    if (entity.modelFile && !/^[a-z][A-Za-z0-9]*$/.test(entity.modelFile)) {
      addIssue(issues, "invalid_model_file", "error", "architectStep1",
        `Entity "${entity.name}" modelFile "${entity.modelFile}" must be camelCase without extension.`);
    }

    if (entity.routeFile && !/^[a-z][A-Za-z0-9]*Routes$/.test(entity.routeFile)) {
      addIssue(issues, "invalid_route_file", "error", "architectStep1",
        `Entity "${entity.name}" routeFile "${entity.routeFile}" must be camelCase ending with Routes.`);
    }
  }
}

function validateEntityRelationshipContracts(blueprint, issues) {
  const entities = blueprint.entities || [];
  const entityNames = new Set(entities.map((entity) => normalizeName(entity.name)));
  const validRelationshipTypes = new Set(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]);

  for (const entity of entities) {
    if (!Array.isArray(entity.relationships)) {
      addIssue(issues, "invalid_relationships", "error", "architectStep1",
        `Entity "${entity.name}" relationships must be an array.`);
      continue;
    }

    for (const relationship of entity.relationships) {
      if (!entityNames.has(normalizeName(relationship.target))) {
        addIssue(issues, "unknown_relationship_target", "error", "architectStep1",
          `Entity "${entity.name}" relationship target "${relationship.target}" does not exist.`);
      }

      if (!validRelationshipTypes.has(relationship.type)) {
        addIssue(issues, "invalid_relationship_type", "error", "architectStep1",
          `Entity "${entity.name}" relationship type "${relationship.type}" is not allowed.`);
      }

      if (relationship.foreignKey && !/^[a-z][a-z0-9_]*$/.test(relationship.foreignKey)) {
        addIssue(issues, "invalid_relationship_foreign_key", "error", "architectStep1",
          `Entity "${entity.name}" relationship foreignKey "${relationship.foreignKey}" must be snake_case.`);
      }
    }
  }
}

function validateDatabaseSchemaContracts(blueprint, clarifiedSpec, issues) {
  const tables = blueprint.dbSchema?.tables || [];
  const databaseType = normalizeName(blueprint.dbSchema?.databaseType);

  if (!["postgresql", "mongodb"].includes(databaseType)) {
    addIssue(issues, "invalid_database_type", "error", "architectStep2",
      `dbSchema.databaseType must be exactly "PostgreSQL" or "MongoDB", but found "${blueprint.dbSchema?.databaseType || ""}".`);
  }

  if (!Array.isArray(blueprint.dbSchema?.tables)) {
    addIssue(issues, "missing_schema_tables", "error", "architectStep2",
      "dbSchema.tables must be an array.");
    return;
  }

  checkUniqueValues(
    tables,
    (table) => table.name,
    "duplicate_schema_table",
    "architectStep2",
    "Database table names must be unique.",
    issues
  );

  for (const table of tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table.name || "")) {
      addIssue(issues, "invalid_schema_table_name", "error", "architectStep2",
        `Database table "${table.name || ""}" must be snake_case.`);
    }

    const fields = Array.isArray(table.fields) ? table.fields : [];

    if (!fields.length) {
      addIssue(issues, "missing_table_fields", "error", "architectStep2",
        `Table "${table.name}" must include a non-empty fields array.`);
      continue;
    }

    checkUniqueValues(
      fields,
      (field) => field.name,
      "duplicate_table_field",
      "architectStep2",
      `Table "${table.name}" has duplicate field names.`,
      issues
    );

    validateRequiredTableFields(table, fields, clarifiedSpec, issues);
    validateTableFieldContracts(table, fields, issues);
  }
}

function validateRequiredTableFields(table, fields, clarifiedSpec, issues) {
  const fieldNames = new Set(fields.map((field) => normalizeName(field.name)));

  for (const requiredField of ["id", "created_at", "updated_at"]) {
    if (!fieldNames.has(requiredField)) {
      addIssue(issues, "missing_required_table_field", "error", "architectStep2",
        `Table "${table.name}" must include "${requiredField}".`);
    }
  }

  if (clarifiedSpec?.authRequired && normalizeName(table.name) === "users" && !fieldNames.has("password_hash")) {
    addIssue(issues, "missing_password_hash", "error", "architectStep2",
      'Auth users table must include "password_hash".');
  }
}

function validateTableFieldContracts(table, fields, issues) {
  for (const field of fields) {
    if (!/^[a-z][a-z0-9_]*$/.test(field.name || "")) {
      addIssue(issues, "invalid_field_name", "error", "architectStep2",
        `Table "${table.name}" field "${field.name || ""}" must be snake_case.`);
    }

    if (!field.type) {
      addIssue(issues, "missing_field_type", "error", "architectStep2",
        `Table "${table.name}" field "${field.name || ""}" must include a specific type.`);
    }

    if (normalizeName(field.name) === "id" && !String(field.type || "").toUpperCase().includes("UUID")) {
      addIssue(issues, "invalid_id_field_type", "error", "architectStep2",
        `Table "${table.name}" id field should use UUID.`);
    }
  }
}

function validateApiEndpointContracts(blueprint, issues) {
  const endpoints = blueprint.apiEndpoints || [];
  const entitiesByTable = new Map(
    (blueprint.entities || [])
      .filter((entity) => entity.tableName)
      .map((entity) => [normalizeName(entity.tableName), entity])
  );

  if (!Array.isArray(blueprint.apiEndpoints) || blueprint.apiEndpoints.length === 0) {
    addIssue(issues, "missing_api_endpoints", "error", "architectStep3",
      "blueprint.apiEndpoints must be a non-empty array.");
    return;
  }

  checkUniqueValues(
    endpoints,
    (endpoint) => `${normalizeName(endpoint.method)} ${cleanApiPath(endpoint.path)}`,
    "duplicate_api_endpoint",
    "architectStep3",
    "API method/path combinations must be unique.",
    issues
  );

  for (const endpoint of endpoints) {
    const method = normalizeName(endpoint.method);
    const path = cleanApiPath(endpoint.path);

    if (!HTTP_METHODS.includes(method)) {
      addIssue(issues, "invalid_http_method", "error", "architectStep3",
        `API "${endpoint.method} ${endpoint.path}" uses unsupported HTTP method "${endpoint.method}".`);
    }

    if (!path.startsWith("/api/v1/")) {
      addIssue(issues, "invalid_api_version", "error", "architectStep3",
        `API "${endpoint.method} ${endpoint.path}" must use the /api/v1 prefix.`);
    }

    if (!endpoint.relatedTable) {
      addIssue(issues, "missing_related_table", "error", "architectStep3",
        `API "${endpoint.method} ${endpoint.path}" must define relatedTable.`);
      continue;
    }

    const entity = entitiesByTable.get(normalizeName(endpoint.relatedTable));
    const isAuthEndpoint = path === "/api/v1/auth/register" || path === "/api/v1/auth/login";

    if (!entity || isAuthEndpoint) {
      continue;
    }

    const expectedBase = cleanApiPath(entity.apiPath);
    if (path !== expectedBase && !path.startsWith(`${expectedBase}/`)) {
      addIssue(issues, "api_path_entity_mismatch", "error", "architectStep3",
        `API "${endpoint.method} ${endpoint.path}" references "${endpoint.relatedTable}" but does not use entity apiPath "${entity.apiPath}".`);
    }
  }
}

function validateApiCrudCoverage(blueprint, issues) {
  const endpoints = blueprint.apiEndpoints || [];

  for (const entity of blueprint.entities || []) {
    if (!entity.apiPath || !entity.tableName) continue;

    const basePath = cleanApiPath(entity.apiPath);
    const requiredEndpoints = [
      ["get", basePath],
      ["get", `${basePath}/:param`],
      ["post", basePath],
      ["delete", `${basePath}/:param`],
    ];
    const hasUpdate = endpoints.some((endpoint) =>
      ["put", "patch"].includes(normalizeName(endpoint.method)) &&
      cleanApiPath(endpoint.path) === `${basePath}/:param` &&
      normalizeName(endpoint.relatedTable) === normalizeName(entity.tableName)
    );

    for (const [method, path] of requiredEndpoints) {
      const exists = endpoints.some((endpoint) =>
        normalizeName(endpoint.method) === method &&
        cleanApiPath(endpoint.path) === path &&
        normalizeName(endpoint.relatedTable) === normalizeName(entity.tableName)
      );

      if (!exists) {
        addIssue(issues, "missing_crud_endpoint", "error", "architectStep3",
          `Entity "${entity.name}" must include ${method.toUpperCase()} ${path.replace(":param", ":id")} with relatedTable "${entity.tableName}".`);
      }
    }

    if (!hasUpdate) {
      addIssue(issues, "missing_update_endpoint", "error", "architectStep3",
        `Entity "${entity.name}" must include PUT or PATCH ${basePath}/:id with relatedTable "${entity.tableName}".`);
    }
  }
}

function validateFrontendContracts(blueprint, issues) {
  if (!Array.isArray(blueprint.frontendPages) || blueprint.frontendPages.length === 0) {
    addIssue(issues, "missing_frontend_pages", "error", "architectStep4",
      "blueprint.frontendPages must be a non-empty array.");
    return;
  }

  checkUniqueValues(
    blueprint.frontendPages || [],
    (page) => page.name,
    "duplicate_page_name",
    "architectStep4",
    "Frontend page names must be unique.",
    issues
  );
  checkUniqueValues(
    blueprint.frontendPages || [],
    (page) => normalizeRoute(page.route),
    "duplicate_page_route",
    "architectStep4",
    "Frontend page routes must be unique.",
    issues
  );
  checkUniqueValues(
    blueprint.sharedComponents || [],
    (component) => component.name,
    "duplicate_component_name",
    "architectStep4",
    "Shared component names must be unique.",
    issues
  );

  for (const page of blueprint.frontendPages || []) {
    if (!/^[A-Z][A-Za-z0-9]*Page$/.test(page.name || "")) {
      addIssue(issues, "invalid_page_name", "error", "architectStep4",
        `Frontend page name "${page.name || ""}" must be PascalCase ending with Page.`);
    }

    if (!normalizeRoute(page.route)) {
      addIssue(issues, "missing_page_route", "error", "architectStep4",
        `Frontend page "${page.name || ""}" must include a route.`);
    }

    if (!Array.isArray(page.components)) {
      addIssue(issues, "invalid_page_components", "error", "architectStep4",
        `Frontend page "${page.name || ""}" components must be an array.`);
    }
  }

  for (const component of blueprint.sharedComponents || []) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(component.name || "")) {
      addIssue(issues, "invalid_component_name", "error", "architectStep4",
        `Shared component name "${component.name || ""}" must be PascalCase.`);
    }
  }
}

function validateForeignKeys(blueprint, issues) {
  const tables = blueprint.dbSchema?.tables || [];
  const tableNames = tables.map((table) => normalizeName(table.name));
  const tablesByName = new Map(tables.map((table) => [normalizeName(table.name), table]));

  for (const table of tables) {
    const fieldNames = new Set((table.fields || []).map((field) => normalizeName(field.name)));
    const indexes = new Set((table.indexes || []).map(normalizeName));

    for (const foreignKey of table.foreignKeys || []) {
      const referencedTable = readReferencedTable(foreignKey.references);
      const referencedField = readReferencedField(foreignKey.references);
      const foreignKeyField = normalizeName(foreignKey.field);

      if (!foreignKeyField || !fieldNames.has(foreignKeyField)) {
        addIssue(issues, "invalid_foreign_key_field", "error", "architectStep2",
          `Table "${table.name}" foreign key field "${foreignKey.field || ""}" does not exist in table fields.`);
      }

      if (!referencedTable || !referencedField) {
        addIssue(issues, "invalid_foreign_key_reference", "error", "architectStep2",
          `Table "${table.name}" foreign key reference "${foreignKey.references || ""}" must use "table_name(field)".`);
        continue;
      }

      if (referencedTable && !tableNames.includes(referencedTable)) {
        addIssue(issues, "invalid_foreign_key", "error", "architectStep2",
          `Table "${table.name}" references "${foreignKey.references}", but table "${referencedTable}" does not exist.`);
        continue;
      }

      const referencedTableFields = new Set(
        (tablesByName.get(referencedTable)?.fields || []).map((field) => normalizeName(field.name))
      );

      if (!referencedTableFields.has(referencedField)) {
        addIssue(issues, "invalid_foreign_key_reference_field", "error", "architectStep2",
          `Table "${table.name}" references "${foreignKey.references}", but field "${referencedField}" does not exist on table "${referencedTable}".`);
      }

      if (foreignKeyField && !indexes.has(foreignKeyField)) {
        addIssue(issues, "missing_foreign_key_index", "error", "architectStep2",
          `Table "${table.name}" foreign key field "${foreignKey.field}" must be listed in indexes.`);
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
          addIssue(issues, "missing_api", "error", "architectStep3",
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
        addIssue(issues, "auth_mismatch", "error", "architectStep4",
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

    addIssue(issues, "orphan_table", "error", "architectStep3",
      `Table "${table.name}" exists but no API endpoint references it.`);
  }
}

function validateProjectStructure(blueprint, clarifiedSpec, issues) {
  const structurePaths = extractPathsFromFolderStructure(blueprint.folderStructure || "");
  const requiredFiles = [
    ...REQUIRED_BACKEND_PATHS,
    ...REQUIRED_FRONTEND_PATHS,
    ...buildNamingMapRequiredPaths(blueprint, clarifiedSpec),
  ];

  for (const filePath of requiredFiles) {
    if (!structurePaths.has(filePath)) {
      addIssue(issues, "missing_folder_entry", "error", "architectStep5",
        `Folder structure is missing "${filePath}".`);
    }
  }
}

function buildNamingMapRequiredPaths(blueprint, clarifiedSpec) {
  const paths = [];

  for (const entity of blueprint.entities || []) {
    if (entity.modelFile) {
      paths.push(`backend/src/models/${entity.modelFile}.js`);
      paths.push(`backend/src/controllers/${entity.modelFile}Controller.js`);
    }

    if (entity.routeFile) {
      paths.push(`backend/src/routes/${entity.routeFile}.js`);
    }
  }

  for (const page of blueprint.frontendPages || []) {
    if (page.name) {
      paths.push(`frontend/src/pages/${page.name}.jsx`);
    }
  }

  for (const component of blueprint.sharedComponents || []) {
    if (component.name) {
      paths.push(`frontend/src/components/${component.name}.jsx`);
    }
  }

  if (clarifiedSpec?.authRequired) {
    paths.push("backend/src/middleware/auth.js");
    paths.push("frontend/src/context/AuthContext.jsx");
  }

  return Array.from(new Set(paths));
}

function validateDependencies(blueprint, clarifiedSpec, issues) {
  const backend = blueprint.dependencies?.backend || {};
  const frontend = blueprint.dependencies?.frontend || {};

  checkPackages(backend.dependencies || {}, REQUIRED_BACKEND_DEPENDENCIES, "backend dependency", issues);
  if (clarifiedSpec?.authRequired) {
    checkPackages(backend.dependencies || {}, REQUIRED_AUTH_BACKEND_DEPENDENCIES, "backend auth dependency", issues);
  }
  checkPackages(backend.devDependencies || {}, [["nodemon", "^3.0.0"]], "backend devDependency", issues);
  checkPackages(frontend.dependencies || {}, REQUIRED_FRONTEND_DEPENDENCIES, "frontend dependency", issues);
  checkPackages(frontend.devDependencies || {}, REQUIRED_FRONTEND_DEV_DEPENDENCIES, "frontend devDependency", issues);

  const databaseType = normalizeName(blueprint.dbSchema?.databaseType);

  if (databaseType === "postgresql") {
    checkPackages(backend.dependencies || {}, [["pg", "^8.11.0"]], "backend dependency", issues);

    if (backend.dependencies?.mongoose) {
      addIssue(issues, "wrong_database_dependency", "error", "architectStep5",
        "PostgreSQL projects should not include mongoose unless both databases are required.");
    }
  }

  if (databaseType === "mongodb") {
    checkPackages(backend.dependencies || {}, [["mongoose", "^8.8.0"]], "backend dependency", issues);

    if (backend.dependencies?.pg) {
      addIssue(issues, "wrong_database_dependency", "error", "architectStep5",
        "MongoDB projects should not include pg unless both databases are required.");
    }
  }
}

function checkPackages(actualPackages, requiredPackages, label, issues) {
  for (const [packageName, expectedVersion] of requiredPackages) {
    const actualVersion = actualPackages[packageName];

    if (!actualVersion) {
      addIssue(issues, "missing_dependency", "error", "architectStep5",
        `Missing ${label} "${packageName}".`);
      continue;
    }

    const actualMajor = readMajorVersion(actualVersion);
    const expectedMajor = readMajorVersion(expectedVersion);

    if (actualMajor !== null && expectedMajor !== null && actualMajor !== expectedMajor) {
      addIssue(issues, "dependency_major_mismatch", "error", "architectStep5",
        `Expected ${label} "${packageName}" to use major version ${expectedMajor}, but found "${actualVersion}".`);
    }
  }
}

function checkUniqueValues(items, readValue, type, fixTarget, message, issues) {
  const seen = new Map();

  for (const item of items || []) {
    const rawValue = readValue(item);
    const value = normalizeName(rawValue);

    if (!value) {
      continue;
    }

    if (!seen.has(value)) {
      seen.set(value, rawValue);
      continue;
    }

    addIssue(issues, type, "error", fixTarget,
      `${message} Duplicate value: "${rawValue}".`);
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

  return {
    blueprintValidation: {
      isValid: false,
      issues,
      validationCycles: currentCycles + 1,
    },
    error: currentCycles + 1 >= MAX_VALIDATION_CYCLES
      ? "blueprintValidator failed: blueprint still has validation issues after maximum repair cycles."
      : undefined,
  };
}

function endpointMatches(endpoint, method, path) {
  return normalizeName(endpoint.method) === method && cleanApiPath(endpoint.path) === cleanApiPath(path);
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

function readReferencedField(reference = "") {
  const match = String(reference).match(/\(([^)]+)\)/);
  return normalizeName(match?.[1] || "");
}

function isJoinTable(table, entityTableNames) {
  const tableName = normalizeName(table.name);
  const foreignKeys = table.foreignKeys || [];

  return !entityTableNames.includes(tableName) && tableName.includes("_") && foreignKeys.length >= 2;
}

function extractPathsFromFolderStructure(folderStructure) {
  const paths = new Set();
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

    const isDirectory = name.endsWith("/");
    const explicitPath = name.includes("/") && !isDirectory
      ? name.replace(/\/$/, "")
      : "";
    const parentPath = stack.length ? stack[stack.length - 1].path : "";
    const path = normalizeProjectPath(
      explicitPath || joinPath(parentPath, name.replace(/\/$/, ""))
    );
    const storedPath = isDirectory ? `${path}/` : path;

    paths.add(storedPath);

    if (isDirectory) {
      stack.push({ indent, path });
    }
  }

  return paths;
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

function normalizeRoute(route = "") {
  const value = String(route).trim();

  if (!value) {
    return "";
  }

  return value.startsWith("/") ? value : `/${value}`;
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
