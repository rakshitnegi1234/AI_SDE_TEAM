import { readFile } from "../utils/sandboxManager.js";

export function contextBuilderNode(state) {
  console.log("\n[Context Builder] Building context for Coder...\n");

  const {
    blueprint,
    clarifiedSpec,
    currentTask,
    fileRegistry = [],
    projectPatterns = {},
    sandboxId,
  } = state;

  if (!currentTask) {
    console.log("No current task found.");
    return { contextPackage: null };
  }

  const filesToCreate = currentTask.filesToCreate || [];
  const filesNeeded = currentTask.filesNeeded || [];
  const dependencyPaths = discoverDependencyPaths({
    filesNeeded,
    filesToCreate,
    fileRegistry,
  });

  const context = {
    task: {
      taskId: currentTask.taskId,
      title: currentTask.title,
      description: currentTask.description,
      filesToCreate,
      acceptanceCriteria: currentTask.acceptanceCriteria || [],
    },

    appName: clarifiedSpec?.appName || "app",
    authRequired: clarifiedSpec?.authRequired || false,

    patterns: projectPatterns,
    dependencies: blueprint?.dependencies || {},
    namingMap: buildNamingMap(blueprint?.entities),

    dependencyInterfaces: buildDependencyInterfaces({
      filesNeeded: dependencyPaths,
      filesToCreate,
      fileRegistry,
      sandboxId,
    }),

    dbSchema: isBackendTask(filesToCreate)
      ? blueprint?.dbSchema || null
      : null,

    apiEndpoints: isFrontendTask(filesToCreate)
      ? blueprint?.apiEndpoints || null
      : null,
  };

  printSummary(context, filesToCreate);

  return {
    contextPackage: context,
  };
}

function buildNamingMap(entities = []) {
  return entities.map((entity) => ({
    entity: entity.name,
    tableName: entity.tableName,
    apiPath: entity.apiPath,
    modelFile: entity.modelFile,
    routeFile: entity.routeFile,
  }));
}

function discoverDependencyPaths({
  filesNeeded,
  filesToCreate,
  fileRegistry,
}) {
  const dependencyPaths = new Set(filesNeeded);

  if (isBackendRouteTask(filesToCreate)) {
    addRegistryPaths(dependencyPaths, fileRegistry, (path) =>
      path.includes("models/") ||
      path.includes("middleware/") ||
      path.includes("config/")
    );
  }

  if (isFrontendViewTask(filesToCreate)) {
    addRegistryPaths(dependencyPaths, fileRegistry, (path) =>
      path.includes("utils/api") ||
      path.includes("context/") ||
      path.includes("hooks/")
    );
  }

  if (isIntegrationTask(filesToCreate)) {
    const needsBackendFiles = filesToCreate.some((path) => path.startsWith("backend/"));
    const needsFrontendFiles = filesToCreate.some((path) => path.startsWith("frontend/"));

    addRegistryPaths(dependencyPaths, fileRegistry, (path) =>
      (needsBackendFiles && path.startsWith("backend/")) ||
      (needsFrontendFiles && path.startsWith("frontend/"))
    );
  }

  return Array.from(dependencyPaths);
}

function addRegistryPaths(dependencyPaths, fileRegistry, shouldInclude) {
  for (const entry of fileRegistry) {
    if (entry?.path && shouldInclude(entry.path)) {
      dependencyPaths.add(entry.path);
    }
  }
}

function buildDependencyInterfaces({
  filesNeeded,
  filesToCreate,
  fileRegistry,
  sandboxId,
}) {
  const interfaces = {};

  for (const filePath of filesNeeded) {
    if (filesToCreate.includes(filePath)) {
      continue;
    }

    const registryEntry = fileRegistry.find((entry) => entry.path === filePath);

    if (registryEntry) {
      interfaces[filePath] = {
        importStatement: registryEntry.importStatement,
        exports: registryEntry.exports,
        interface: registryEntry.interface,
      };

      continue;
    }

    const diskEntry = readBasicInterfaceFromDisk(sandboxId, filePath);

    if (diskEntry) {
      interfaces[filePath] = diskEntry;
    }
  }

  return interfaces;
}

function readBasicInterfaceFromDisk(sandboxId, filePath) {
  if (!sandboxId) {
    return null;
  }

  try {
    const content = readFile(sandboxId, filePath);

    if (!content) {
      return null;
    }

    return extractBasicInterface(content, filePath);
  } catch {
    return null;
  }
}

function extractBasicInterface(content, filePath) {
  const namedExports = [];
  let defaultExport = null;

  for (const line of content.split("\n")) {
    const namedMatch = line.match(
      /export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/
    );

    if (namedMatch) {
      namedExports.push(namedMatch[1]);
    }

    const defaultMatch = line.match(
      /export\s+default\s+(?:function\s+)?(\w+)?/
    );

    if (defaultMatch?.[1]) {
      defaultExport = defaultMatch[1];
    }
  }

  return {
    importStatement: buildImportStatement(filePath, namedExports, defaultExport),
    exports: [...namedExports, ...(defaultExport ? [defaultExport] : [])],
    interface:
      [...namedExports, ...(defaultExport ? [`default:${defaultExport}`] : [])]
        .join(", ") || "unknown exports",
  };
}

function buildImportStatement(filePath, namedExports, defaultExport) {
  if (defaultExport && namedExports.length > 0) {
    return `import ${defaultExport}, { ${namedExports.join(", ")} } from '${filePath}'`;
  }

  if (defaultExport) {
    return `import ${defaultExport} from '${filePath}'`;
  }

  if (namedExports.length > 0) {
    return `import { ${namedExports.join(", ")} } from '${filePath}'`;
  }

  return "";
}

function isBackendTask(filesToCreate) {
  return filesToCreate.some((filePath) => filePath.includes("backend"));
}

function isFrontendTask(filesToCreate) {
  return filesToCreate.some((filePath) => filePath.includes("frontend"));
}

function isBackendRouteTask(filesToCreate) {
  return filesToCreate.some((filePath) =>
    filePath.includes("routes/") || filePath.includes("controllers/")
  );
}

function isFrontendViewTask(filesToCreate) {
  return filesToCreate.some((filePath) =>
    filePath.includes("pages/") || filePath.includes("components/")
  );
}

function isIntegrationTask(filesToCreate) {
  return filesToCreate.some((filePath) =>
    filePath.endsWith("index.js") ||
    filePath.endsWith("App.jsx") ||
    filePath.endsWith("server.js")
  );
}

function printSummary(context, filesToCreate) {
  const dependencyCount = Object.keys(context.dependencyInterfaces).length;

  console.log(`Context size: ${JSON.stringify(context).length} characters`);
  console.log(`Files to create: ${filesToCreate.join(", ") || "none"}`);
  console.log(`Dependency interfaces: ${dependencyCount}`);
}
