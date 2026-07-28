/**
 * presentToUser.js — Final project presentation
 */

import { getFileList } from "../utils/sandboxManager.js";

export function presentToUserNode(state) {
  console.log("\n" + "🎉".repeat(25));
  console.log("\n  🚀 PROJECT COMPLETE!\n");
  console.log("═".repeat(60));

  // Project info
  console.log(`  App: ${state.clarifiedSpec?.appName || "Unknown"}`);
  console.log(`  Description: ${state.clarifiedSpec?.description || ""}`);

  // Task summary
  const statuses = state.taskStatuses || {};
  const done = Object.values(statuses).filter(s => s === "done").length;
  const total = Object.keys(statuses).length;
  console.log(`\n  📋 Tasks completed: ${done}/${total}`);

  // Files created
  if (state.sandboxId) {
    try {
      const files = getFileList(state.sandboxId);
      const codeFiles = files.filter(f =>
        !f.includes("node_modules") && !f.includes(".git") && !f.includes("package-lock")
      );
      console.log(`  📂 Files created: ${codeFiles.length}`);
      codeFiles.forEach(f => console.log(`     ${f}`));

    } catch (e) { /* sandbox might be unavailable */ }
  }

  console.log("═".repeat(60));
  console.log("  PROJECT OUTPUT:\n");

  console.log("  App URL will appear in the dashboard after launch.");

  console.log("═".repeat(60));
  console.log("  ✅ Ready for your review!\n");

  return {
    currentPhase: "done",
  };
}
