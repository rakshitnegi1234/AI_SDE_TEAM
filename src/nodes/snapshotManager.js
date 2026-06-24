import { snapshot } from "../utils/sandboxManager.js";

export function snapshotManagerNode(state) {
  console.log("\n[Snapshot] Saving checkpoint...\n");

  const { currentTask, sandboxId } = state;

  if (!currentTask) {
    console.log("   No current task");
    return {};
  }

  if (!sandboxId) {
    console.log("   No sandbox; marking task done");
    return { taskStatuses: { [currentTask.taskId]: "done" } };
  }

  const message = `Task ${currentTask.taskId}: ${currentTask.title}`;
  let result;
  try {
    result = snapshot(sandboxId, message);
  } catch (error) {
    result = { success: false, error: error.message };
  }

  if (result.success) {
    console.log(`   Snapshot: ${result.tag} - "${message}"`);
  } else {
    console.log(`   Snapshot failed: ${result.error}. Task still marked done.`);
  }

  return {
    taskStatuses: { [currentTask.taskId]: "done" },
    reviewResult: { verdict: "", issues: [], reviewCycle: 0 },
    executionResult: { result: "", output: "", errors: "" },
    debugState: { tier: 1, attempts: 0, maxAttempts: 3, rollbackAttempted: false },
    coderOutput: null,
    contextPackage: null,
    currentTask: null,
  };
}
