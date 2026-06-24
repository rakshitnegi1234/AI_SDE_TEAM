/**
 * presentToUser.js — Final project presentation
 */

import { getFileList, getSandboxPath } from "../utils/sandboxManager.js";

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

      const sandboxPath = getSandboxPath(state.sandboxId);
      console.log(`\n  📍 Project location: ${sandboxPath}`);
    } catch (e) { /* sandbox might be unavailable */ }
  }

  // How to run
  console.log("═".repeat(60));
  console.log("  🏃 DOCKER APP STATUS:\n");

  const deployment = state.deploymentConfig || {};
  if (deployment.verified) {
    console.log("  Docker deployment verified and services are running.");
  } else if (deployment.files?.length) {
    console.log("  Docker deployment files were generated, but services were not verified as running.");
  }

  const sandboxPath = state.sandboxId ? getSandboxPath(state.sandboxId) : null;
  if (sandboxPath) {
    const composeCommand = deployment.platform || "docker compose";
    console.log(`  cd ${sandboxPath}`);
    console.log(`  ${composeCommand} up --build`);
    console.log("");
    console.log("  Open:");
    console.log(`  🌐 Frontend: ${deployment.frontendUrl || "http://localhost:15173"}`);
    console.log(`  🔌 Backend:  ${deployment.backendUrl || "http://localhost:15000"}`);
    console.log("");
    console.log(`  To stop: ${composeCommand} down`);
  } else {
    console.log("  Project files were not available for run instructions.");
  }

  console.log("═".repeat(60));
  console.log("  ✅ Ready for your review!\n");

  return {
    currentPhase: "done",
    userSatisfied: false,
  };
}
