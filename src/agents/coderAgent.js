import { safeCallGemini } from "../utils/gemini.js";
import { readFile, writeFile } from "../utils/sandboxManager.js";

const BACKEND_PROMPT = `You are a senior backend developer. Write ONE backend-side project file.

OUTPUT FORMAT (strict JSON - single file only):
{
  "path": "backend/src/models/todoItem.js",
  "content": "// Full file content here",
  "notes": "Brief explanation"
}

RULES:
- The requested file may be JavaScript, JSON, .env.example, Markdown, or config.
- For JavaScript, use ES module syntax only. Use import/export, never require.
- For package.json, include scripts and dependencies from the provided dependency contract.
- For .env.example, include placeholder values only, never real secrets.
- For Express files, use Router(), router.get/post/put/delete.
- For DB code, always use parameterized queries. Never concatenate SQL strings.
- For models, return clean data, not raw { rows }. Mark async functions.
- Response format everywhere: { success: true/false, data: ... } or { success: false, message: "..." }.
- If writing auth middleware, export authenticateToken and authorizeRole when auth is required.
- Env vars: process.env.DATABASE_URL, process.env.JWT_SECRET, process.env.PORT.
- Include .js extension in all local imports.
- Write complete files. No TODOs or placeholders.`;

const FRONTEND_PROMPT = `You are a senior React developer. Write ONE frontend-side project file.

OUTPUT FORMAT (strict JSON - single file only):
{
  "path": "frontend/src/pages/DashboardPage.jsx",
  "content": "// Full file content here",
  "notes": "Brief explanation"
}

RULES:
- The requested file may be JSX, JavaScript, JSON, HTML, CSS, or config.
- For React files, use functional components with hooks.
- Use Tailwind CSS in JSX. Do not use inline styles or CSS modules.
- For package.json, include scripts and dependencies from the provided dependency contract.
- For .env.example, include placeholder values only.
- Import the api utility with a correct relative path after it exists.
- Use react-router-dom for navigation.
- Include loading, error, and empty states where data is fetched.
- Forms must use controlled inputs and prevent default submit behavior.
- Never use process.env in frontend files. Use import.meta.env when needed.
- Write complete files. No TODOs or placeholders.`;

const GENERAL_PROMPT = `You are a senior full-stack developer. Write ONE project file.

OUTPUT FORMAT (strict JSON - single file only):
{
  "path": ".gitignore",
  "content": "# Full file content here",
  "notes": "Brief explanation"
}

RULES:
- The requested file may be JSON, Markdown, .gitignore, .env.example, JavaScript, JSX, HTML, CSS, or config.
- For package.json, include scripts and dependencies from the provided dependency contract.
- For .env.example, include placeholder values only, never real secrets.
- For JavaScript/JSX, use ES module syntax.
- Write complete files. No TODOs or placeholders.`;

export async function coderAgentNode(state) {
  console.log("\n[Coder Agent] Writing code...\n");

  const { currentTask, contextPackage, sandboxId } = state;

  if (!currentTask || !contextPackage) {
    console.log("   No task or context");
    return { coderOutput: null };
  }

  const filesToCreate = contextPackage.task.filesToCreate || [];
  const isRetry = state.reviewResult?.verdict === "rejected" && state.reviewResult?.issues?.length > 0;

  let sharedContext = "";

  if (contextPackage.namingMap?.length) {
    sharedContext += "NAMING MAP:\n";
    for (const name of contextPackage.namingMap) {
      sharedContext += `  ${name.entity}: table=${name.tableName}, api=${name.apiPath}, model=${name.modelFile}, route=${name.routeFile}\n`;
    }
    sharedContext += "\n";
  }

  const dependencies = contextPackage.dependencyInterfaces || {};
  if (Object.keys(dependencies).length > 0) {
    sharedContext += "EXISTING FILES YOU CAN IMPORT FROM:\n";
    for (const [depPath, info] of Object.entries(dependencies)) {
      sharedContext += `  ${depPath}: ${info.importStatement || ""}\n`;
      if (info.interface) sharedContext += `    ${info.interface}\n`;
    }
    sharedContext += "\n";
  }

  if (contextPackage.dbSchema) {
    sharedContext += `DATABASE: ${contextPackage.dbSchema.databaseType}\n`;
    sharedContext += `TABLES: ${JSON.stringify(contextPackage.dbSchema.tables, null, 2)}\n\n`;
  }

  if (contextPackage.apiEndpoints) {
    sharedContext += `API ENDPOINTS:\n${JSON.stringify(contextPackage.apiEndpoints, null, 2)}\n\n`;
  }

  if (contextPackage.dependencies) {
    sharedContext += `DEPENDENCY CONTRACT:\n${JSON.stringify(contextPackage.dependencies, null, 2)}\n\n`;
  }

  if (contextPackage.templateFile) {
    sharedContext += `STYLE TEMPLATE:\n--- ${contextPackage.templateFile.path} ---\n`;
    sharedContext += `${contextPackage.templateFile.content}\n\n`;
  }

  let retryContext = "";
  if (isRetry) {
    retryContext += "\nRETRY. Fix these issues:\n";
    for (const issue of state.reviewResult?.issues || []) retryContext += `  - ${issue}\n`;
    if (state.executionResult?.errors) {
      retryContext += `\nEXECUTOR ERROR:\n${state.executionResult.errors.slice(0, 400)}\n`;
    }
  }

  const writtenFiles = [];

  for (const filePath of filesToCreate) {
    console.log(`   Generating: ${filePath}`);

    const isBackend = filePath.startsWith("backend/");
    const isFrontend = filePath.startsWith("frontend/");
    const systemPrompt = isBackend ? BACKEND_PROMPT : isFrontend ? FRONTEND_PROMPT : GENERAL_PROMPT;

    let userPrompt = `FILE TO WRITE: ${filePath}\n`;
    userPrompt += `TASK: ${currentTask.title}\n`;
    userPrompt += `DESCRIPTION: ${currentTask.description || ""}\n\n`;

    if (contextPackage.task.acceptanceCriteria?.length) {
      userPrompt += "ACCEPTANCE CRITERIA:\n";
      userPrompt += contextPackage.task.acceptanceCriteria.map((criterion) => `  - ${criterion}`).join("\n");
      userPrompt += "\n\n";
    }

    userPrompt += sharedContext;

    if (isRetry) {
      userPrompt += retryContext;
      try {
        const currentContent = readFile(sandboxId, filePath);
        if (currentContent) {
          userPrompt += `\nCURRENT FILE ON DISK:\n--- ${filePath} ---\n${currentContent}\n`;
        }
      } catch {
        // The retry can still generate a fresh file.
      }
    }

    userPrompt += `\nAPP: ${contextPackage.appName}\n`;
    userPrompt += `Return JSON with path, content, and notes. The path must be exactly "${filePath}".\n`;

    const result = await safeCallGemini({
      systemPrompt,
      userPrompt,
      agentName: "coderAgent",
    });

    if (!result.ok) {
      console.error(`   Failed: ${filePath} - ${result.error}`);
      writtenFiles.push({ path: filePath, lines: 0, error: result.error });
      continue;
    }

    let fileData = result.parsed;
    if (fileData.files && Array.isArray(fileData.files)) {
      fileData = fileData.files[0] || {};
    }

    const outputPath = fileData.path || filePath;
    const content = fileData.content || "";

    if (!content) {
      console.error(`   Empty output: ${filePath}`);
      writtenFiles.push({ path: filePath, lines: 0, error: "Empty content" });
      continue;
    }

    if (outputPath !== filePath) {
      console.warn(`   Path mismatch: requested "${filePath}" but got "${outputPath}". Writing requested path.`);
    }

    try {
      writeFile(sandboxId, filePath, content);
      const lines = content.split("\n").length;
      console.log(`   Wrote: ${filePath} (${lines} lines)`);
      writtenFiles.push({ path: filePath, lines });
    } catch (error) {
      console.error(`   Write failed: ${filePath} - ${error.message}`);
      writtenFiles.push({ path: filePath, lines: 0, error: error.message });
    }
  }

  const successCount = writtenFiles.filter((file) => !file.error).length;
  const failCount = writtenFiles.filter((file) => file.error).length;
  const allFailed = successCount === 0 && filesToCreate.length > 0;
  console.log(`\n   Done: ${successCount} written, ${failCount} failed`);

  return {
    coderOutput: {
      files: writtenFiles,
      notes: allFailed ? "All files failed to generate" : `${successCount} files written`,
      error: allFailed,
    },
  };
}
