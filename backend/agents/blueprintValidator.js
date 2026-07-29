const MAX_VALIDATION_CYCLES = 3;

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
];

export async function blueprintValidatorNode(state) {
  console.log("\n[Blueprint Validator] Checking blueprint\n");

  const blueprint = state.blueprint || {};
  const issues = [];

  validateEntities(blueprint, issues);
  validateTables(blueprint, issues);
  validateApiEndpoints(blueprint, issues);

  return finishValidation(state, issues);
}

export function blueprintValidatorRouter(state) {
  const validation = state.blueprintValidation;

  if (!validation) {
    return "__end__";
  }

  if (validation.isValid) {
    return "__end__";
  }

  if (validation.validationCycles >= MAX_VALIDATION_CYCLES) {
    return "__failed__";
  }

  if (validation.issues && validation.issues.length > 0) {
    return validation.issues[0].fixTarget;
  }

  return "__end__";
}

/*
  Check entities.

  Every entity should have:
  - name
  - tableName
  - apiPath

  The entity table must also exist.
*/
function validateEntities(blueprint, issues) {
  const entities = getList(blueprint.entities);
  const tables = getTables(blueprint);

  if (entities.length === 0) {
    addIssue(
      issues,
      "missing_entities",
      "architectStep1",
      "Blueprint must contain at least one entity."
    );

    return;
  }

  for (const entity of entities) {
    if (!entity.name) {
      addIssue(
        issues,
        "missing_entity_name",
        "architectStep1",
        "An entity is missing its name."
      );
    }

    if (!entity.tableName) {
      addIssue(
        issues,
        "missing_entity_table",
        "architectStep1",
        `Entity "${entity.name || "unknown"}" is missing tableName.`
      );
    }

    if (!entity.apiPath) {
      addIssue(
        issues,
        "missing_entity_api_path",
        "architectStep1",
        `Entity "${entity.name || "unknown"}" is missing apiPath.`
      );
    }

    if (entity.tableName) {
      const table = findTable(tables, entity.tableName);

      if (!table) {
        addIssue(
          issues,
          "entity_table_not_found",
          "architectStep2",
          `Entity "${entity.name || "unknown"}" uses table "${entity.tableName}", but that table does not exist.`
        );
      }
    }
  }
}

/*
  Check database tables.

  Every table should have:
  - name
  - fields
  - id field
*/
function validateTables(blueprint, issues) {
  const tables = getTables(blueprint);

  if (tables.length === 0) {
    addIssue(
      issues,
      "missing_tables",
      "architectStep2",
      "Database schema must contain at least one table."
    );

    return;
  }

  for (const table of tables) {
    if (!table.name) {
      addIssue(
        issues,
        "missing_table_name",
        "architectStep2",
        "A database table is missing its name."
      );
    }

    const fields = getList(table.fields);

    if (fields.length === 0) {
      addIssue(
        issues,
        "missing_table_fields",
        "architectStep2",
        `Table "${table.name || "unknown"}" must contain fields.`
      );

      continue;
    }

    const idField = findField(fields, "id");

    if (!idField) {
      addIssue(
        issues,
        "missing_id_field",
        "architectStep2",
        `Table "${table.name || "unknown"}" must contain an "id" field.`
      );
    }

    for (const field of fields) {
      if (!field.name) {
        addIssue(
          issues,
          "missing_field_name",
          "architectStep2",
          `Table "${table.name || "unknown"}" contains a field without a name.`
        );
      }

      if (!field.type) {
        addIssue(
          issues,
          "missing_field_type",
          "architectStep2",
          `Field "${field.name || "unknown"}" in table "${table.name || "unknown"}" is missing its type.`
        );
      }
    }
  }
}

/*
  Check API endpoints.

  Every API should have:
  - valid HTTP method
  - /api/v1 path
  - relatedTable

  The related table must exist.
*/
function validateApiEndpoints(blueprint, issues) {
  const endpoints = getList(blueprint.apiEndpoints);
  const tables = getTables(blueprint);
  const entities = getList(blueprint.entities);

  if (endpoints.length === 0) {
    addIssue(
      issues,
      "missing_api_endpoints",
      "architectStep3",
      "Blueprint must contain at least one API endpoint."
    );

    return;
  }

  for (const endpoint of endpoints) {
    const method = normalize(endpoint.method);
    const endpointPath = normalize(endpoint.path);

    if (!isValidHttpMethod(method)) {
      addIssue(
        issues,
        "invalid_http_method",
        "architectStep3",
        `API method "${endpoint.method || "unknown"}" is invalid.`
      );
    }

    if (!endpointPath.startsWith("/api/v1/")) {
      addIssue(
        issues,
        "invalid_api_path",
        "architectStep3",
        `API path "${endpoint.path || "unknown"}" must start with "/api/v1/".`
      );
    }

    if (!endpoint.relatedTable) {
      addIssue(
        issues,
        "missing_related_table",
        "architectStep3",
        `API "${endpoint.method || ""} ${endpoint.path || ""}" is missing relatedTable.`
      );

      continue;
    }

    const table = findTable(
      tables,
      endpoint.relatedTable
    );

    if (!table) {
      addIssue(
        issues,
        "api_table_not_found",
        "architectStep3",
        `API "${endpoint.method || ""} ${endpoint.path || ""}" uses missing table "${endpoint.relatedTable}".`
      );

      continue;
    }

    const entity = findEntityByTable(
      entities,
      endpoint.relatedTable
    );

    if (!entity || !entity.apiPath) {
      continue;
    }

    const entityApiPath = normalize(entity.apiPath);

    const exactPath =
      endpointPath === entityApiPath;

    const childPath =
      endpointPath.startsWith(entityApiPath + "/");

    const isAuthRoute =
      endpointPath === "/api/v1/auth/login" ||
      endpointPath === "/api/v1/auth/register";

    if (!exactPath && !childPath && !isAuthRoute) {
      addIssue(
        issues,
        "api_entity_path_mismatch",
        "architectStep3",
        `API "${endpoint.path}" should use entity path "${entity.apiPath}".`
      );
    }
  }
}

/*
  Return the validation result.
*/
function finishValidation(state, issues) {
  let previousCycles = 0;

  if (
    state.blueprintValidation &&
    state.blueprintValidation.validationCycles
  ) {
    previousCycles =
      state.blueprintValidation.validationCycles;
  }

  const currentCycle = previousCycles + 1;
  const isValid = issues.length === 0;

  if (isValid) {
    console.log("Blueprint is valid");
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
      "Blueprint validation failed after maximum repair cycles.";
  }

  return {
    blueprintValidation: {
      isValid: isValid,
      issues: issues,
      validationCycles: currentCycle,
    },

    error: error,
  };
}

/*
  Add one error to the issues array.
*/
function addIssue(
  issues,
  type,
  fixTarget,
  message
) {
  issues.push({
    type: type,
    severity: "error",
    fixTarget: fixTarget,
    message: message,
  });
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
  Get database tables.
*/
function getTables(blueprint) {
  if (!blueprint.dbSchema) {
    return [];
  }

  return getList(blueprint.dbSchema.tables);
}

/*
  Find table by name.
*/
function findTable(tables, tableName) {
  const wantedName = normalize(tableName);

  for (const table of tables) {
    if (normalize(table.name) === wantedName) {
      return table;
    }
  }

  return null;
}

/*
  Find field by name.
*/
function findField(fields, fieldName) {
  const wantedName = normalize(fieldName);

  for (const field of fields) {
    if (normalize(field.name) === wantedName) {
      return field;
    }
  }

  return null;
}

/*
  Find an entity using its tableName.
*/
function findEntityByTable(entities, tableName) {
  const wantedTable = normalize(tableName);

  for (const entity of entities) {
    if (
      normalize(entity.tableName) === wantedTable
    ) {
      return entity;
    }
  }

  return null;
}

/*
  Check HTTP method.
*/
function isValidHttpMethod(method) {
  for (const allowedMethod of HTTP_METHODS) {
    if (method === allowedMethod) {
      return true;
    }
  }

  return false;
}

/*
  Convert values into lowercase text
  so comparisons are easier.
*/
function normalize(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim().toLowerCase();
}