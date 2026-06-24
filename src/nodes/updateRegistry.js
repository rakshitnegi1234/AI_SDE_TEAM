import { safeCallGemini } from "../utils/gemini.js";
import { readFile } from "../utils/sandboxManager.js";

const REGISTRY_PROMPT = `You are analyzing JavaScript and JSX files to extract their public interface.

For each file, extract:
- Default export if any.
- Named exports.
- The exact relative import statement another generated file should use.
- A short interface description.

OUTPUT FORMAT (strict JSON):
{
  "files": [
    {
      "path": "backend/src/config/db.js",
      "defaultExport": null,
      "namedExports": ["pool", "connectDB"],
      "importStatement": "import { pool, connectDB } from '../config/db.js'",
      "interface": "pool: pg Pool instance. connectDB(): async, tests connection."
    }
  ]
}

RULES:
- importStatement must be valid ES module syntax.
- Use relative paths in importStatement.
- List all public exports.
- Mark functions as async or sync when clear.`;

export async function updateRegistryNode(state) {
  console.log("\n[Update Registry] Indexing new files...\n");

  const { coderOutput, sandboxId } = state;

  if (!coderOutput?.files?.length) {
    console.log("   No files to index");
    return {};
  }

  const fileContents = [];
  for (const file of coderOutput.files) {
    if (file.error) continue;
    try {
      const content = readFile(sandboxId, file.path);
      if (content) fileContents.push({ path: file.path, content });
    } catch (error) {
      console.warn(`   Could not read ${file.path}: ${error.message}`);
    }
  }

  if (fileContents.length === 0) {
    console.log("   No file contents to analyze");
    return {};
  }

  const userPrompt = fileContents
    .map((file) => `--- ${file.path} ---\n${file.content}\n`)
    .join("\n");

  const result = await safeCallGemini({
    systemPrompt: REGISTRY_PROMPT,
    userPrompt,
    agentName: "updateRegistry",
  });

  if (!result.ok) {
    console.error(`   updateRegistry failed: ${result.error}`);
    return { error: `updateRegistry failed: ${result.error}` };
  }

  const registryEntries = result.parsed.files || [];

  console.log(`   Indexed ${registryEntries.length} files:`);
  for (const file of registryEntries) {
    console.log(`   ${file.path} -> ${file.importStatement || "no import info"}`);
  }

  return {
    fileRegistry: registryEntries.map((file) => ({
      path: file.path,
      defaultExport: file.defaultExport || null,
      namedExports: file.namedExports || [],
      exports: [...(file.namedExports || []), ...(file.defaultExport ? [file.defaultExport] : [])],
      importStatement: file.importStatement || "",
      interface: file.interface || "",
      updatedAt: Date.now(),
    })),
  };
}
