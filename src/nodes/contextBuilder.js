import { getFileList, readFile } from "../utils/sandboxManager.js";

function extractBasicInterface(content, filePath) {
  const exports = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const namedMatch = line.match(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/);
    if (namedMatch) exports.push(namedMatch[1]);

    const defaultMatch = line.match(/export\s+default\s+(?:function\s+)?(\w+)?/);
    if (defaultMatch?.[1]) exports.push(`default:${defaultMatch[1]}`);
  }

  const namedExports = exports.filter((entry) => !entry.startsWith("default:"));
  const defaultEntry = exports.find((entry) => entry.startsWith("default:"));
  const defaultName = defaultEntry ? defaultEntry.split(":")[1] : null;

  let importStatement = "";
  if (defaultName && namedExports.length > 0) {
    importStatement = `import ${defaultName}, { ${namedExports.join(", ")} } from '${filePath}'`;
  } else if (defaultName) {
    importStatement = `import ${defaultName} from '${filePath}'`;
  } else if (namedExports.length > 0) {
    importStatement = `import { ${namedExports.join(", ")} } from '${filePath}'`;
  }

  return {
    path: filePath,
    exports: [...namedExports, ...(defaultName ? [defaultName] : [])],
    importStatement,
    interface: exports.join(", ") || "unknown exports",
  };
}

export function contextBuilderNode(state) {
  console.log("\n[Context Builder] Assembling context for Coder...\n");

  const {
    blueprint,
    clarifiedSpec,
    currentTask,
    fileRegistry = [],
    projectPatterns,
    sandboxId,
  } = state;

  if (!currentTask) {
    console.log("   No current task");
    return { contextPackage: null };
  }

  const filesToCreate = currentTask.filesToCreate || [];
  const context = {
    task: {
      taskId: currentTask.taskId,
      title: currentTask.title,
      description: currentTask.description,
      filesToCreate,
      acceptanceCriteria: currentTask.acceptanceCriteria || [],
    },
    patterns: projectPatterns || {},
    dependencyInterfaces: {},
    dbSchema: null,
    apiEndpoints: null,
    templateFile: null,
    namingMap: null,
    appName: clarifiedSpec?.appName || "app",
    authRequired: clarifiedSpec?.authRequired || false,
  };

  const autoNeeded = new Set(currentTask.filesNeeded || []);
  const isBackendRoute = filesToCreate.some((filePath) =>
    filePath.includes("routes") || filePath.includes("controllers")
  );
  const isFrontendFile = filesToCreate.some((filePath) =>
    filePath.includes("pages") || filePath.includes("components")
  );
  const isIntegration = filesToCreate.some((filePath) =>
    filePath.endsWith("index.js") || filePath.endsWith("App.jsx") || filePath.endsWith("server.js")
  );

  if (isBackendRoute) {
    for (const entry of fileRegistry) {
      if (
        entry.path?.includes("models/") ||
        entry.path?.includes("middleware/") ||
        entry.path?.includes("config/")
      ) {
        autoNeeded.add(entry.path);
      }
    }
  }

  if (isFrontendFile) {
    for (const entry of fileRegistry) {
      if (
        entry.path?.includes("utils/api") ||
        entry.path?.includes("context/") ||
        entry.path?.includes("hooks/")
      ) {
        autoNeeded.add(entry.path);
      }
    }
  }

  if (isIntegration) {
    const isBackend = filesToCreate.some((filePath) => filePath.includes("backend"));
    const isFrontend = filesToCreate.some((filePath) => filePath.includes("frontend"));
    for (const entry of fileRegistry) {
      if (isBackend && entry.path?.startsWith("backend/")) autoNeeded.add(entry.path);
      if (isFrontend && entry.path?.startsWith("frontend/")) autoNeeded.add(entry.path);
    }
  }

  for (const filePath of autoNeeded) {
    if (filesToCreate.includes(filePath)) continue;

    let entry = fileRegistry.find((registeredFile) => registeredFile.path === filePath);

    if (!entry) {
      const dir = filePath.split("/").slice(0, -1).join("/");
      const name = filePath.split("/").pop().toLowerCase().replace(/\.(js|jsx)$/, "");
      entry = fileRegistry.find((registeredFile) => {
        if (!registeredFile.path) return false;
        const registeredDir = registeredFile.path.split("/").slice(0, -1).join("/");
        const registeredName = registeredFile.path.split("/").pop().toLowerCase().replace(/\.(js|jsx)$/, "");
        return registeredDir === dir && (registeredName.includes(name) || name.includes(registeredName));
      });
      if (entry) console.log(`   Fuzzy match: ${filePath} -> ${entry.path}`);
    }

    if (!entry && sandboxId) {
      try {
        let content = readFile(sandboxId, filePath);

        if (!content) {
          const allFiles = getFileList(sandboxId);
          const dir = filePath.split("/").slice(0, -1).join("/");
          const baseName = filePath.split("/").pop().toLowerCase().replace(/\.(js|jsx)$/, "");
          const match = allFiles.find((candidate) => {
            const candidateDir = candidate.split("/").slice(0, -1).join("/");
            const candidateName = candidate.split("/").pop().toLowerCase().replace(/\.(js|jsx)$/, "");
            return candidateDir === dir && (candidateName.includes(baseName) || baseName.includes(candidateName));
          });
          if (match) content = readFile(sandboxId, match);
        }

        if (content) {
          entry = extractBasicInterface(content, filePath);
          console.log(`   Disk read: ${filePath} -> ${entry.exports.length} exports`);
        }
      } catch {
        // The file is optional context; missing files should not stop the loop.
      }
    }

    if (entry) {
      context.dependencyInterfaces[entry.path || filePath] = {
        importStatement: entry.importStatement,
        exports: entry.exports,
        interface: entry.interface,
      };
    }
  }

  if (blueprint?.entities) {
    context.namingMap = blueprint.entities.map((entity) => ({
      entity: entity.name,
      tableName: entity.tableName,
      apiPath: entity.apiPath,
      modelFile: entity.modelFile,
      routeFile: entity.routeFile,
    }));
  }

  const isBackendTask = filesToCreate.some((filePath) => filePath.includes("backend"));
  if (isBackendTask && blueprint?.dbSchema) {
    const taskText = `${currentTask.title} ${currentTask.description}`.toLowerCase();
    const relevantTables = blueprint.dbSchema.tables?.filter((table) => {
      const tableName = table.name.toLowerCase();
      const singularName = tableName.replace(/_/g, "").replace(/s$/, "");
      return (
        taskText.includes(tableName) ||
        taskText.includes(singularName) ||
        taskText.includes(tableName.replace(/_/g, " "))
      );
    });
    context.dbSchema = {
      databaseType: blueprint.dbSchema.databaseType,
      tables: relevantTables?.length > 0 ? relevantTables : blueprint.dbSchema.tables,
    };
  }

  const isFrontendTask = filesToCreate.some((filePath) => filePath.includes("frontend"));
  if (isFrontendTask && blueprint?.apiEndpoints) {
    const taskText = `${currentTask.title} ${currentTask.description}`.toLowerCase();
    const relevantEndpoints = blueprint.apiEndpoints.filter((endpoint) => {
      const pathParts = endpoint.path?.toLowerCase().split("/") || [];
      return pathParts.some((part) => part.length > 2 && taskText.includes(part));
    });
    const authEndpoints = blueprint.apiEndpoints.filter((endpoint) => endpoint.path?.includes("/auth"));
    const combined = [...new Set([...authEndpoints, ...relevantEndpoints])];
    context.apiEndpoints = combined.length > 0 ? combined : blueprint.apiEndpoints;
  }

  const targetFile = filesToCreate[0] || "";
  const templateType = targetFile.includes("models")
    ? "models"
    : targetFile.includes("routes") || targetFile.includes("controllers")
      ? "routes"
      : targetFile.includes("pages")
        ? "pages"
        : targetFile.includes("components")
          ? "components"
          : "";

  if (templateType && sandboxId) {
    const templateEntry = fileRegistry.find((entry) =>
      entry.path?.includes(templateType) && !filesToCreate.includes(entry.path)
    );
    if (templateEntry) {
      try {
        const content = readFile(sandboxId, templateEntry.path);
        if (content) {
          context.templateFile = {
            path: templateEntry.path,
            content: content.slice(0, 3000),
          };
        }
      } catch {
        // Template context is optional.
      }
    }
  }

  const estimatedTokens = Math.ceil(JSON.stringify(context).length / 4);
  console.log(`   Context size estimate: ${estimatedTokens} tokens`);
  console.log(`   Files to create: ${filesToCreate.join(", ")}`);
  console.log(`   Dependencies: ${Object.keys(context.dependencyInterfaces).length} interfaces`);

  return { contextPackage: context };
}
