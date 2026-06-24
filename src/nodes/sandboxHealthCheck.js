// sandboxHealthCheck.js
// Verifies sandbox containers and workspace health.

import { healthCheck, getSandboxInfo } from "../utils/sandboxManager.js";

export async function sandboxHealthCheckNode(state) {
  console.log("\n[Sandbox Health Check] Verifying workspace...\n");

  const { sandboxId } = state;

  if (!sandboxId) {
    return markSandboxUnhealthy("No sandbox ID found.");
  }

  const sandboxInfo = getSandboxInfo(sandboxId);
  const healthResult = await healthCheck(sandboxId);

  if (!healthResult.healthy) {
    return handleFailedHealthCheck(healthResult);
  }

  printHealthySandbox(healthResult, sandboxInfo);

  return {
    sandboxHealthy: true,
    error: null,
  };
}

function markSandboxUnhealthy(message) {
  console.log(`Health check failed: ${message}`);

  return {
    sandboxHealthy: false,
    error: message,
  };
}

function handleFailedHealthCheck(healthResult) {
  const failures = healthResult.failures || [];

  console.log("Health check failed. Issues found:");

  failures.forEach((failure) => {
    console.log(`- ${failure}`);
  });

  return {
    sandboxHealthy: false,
    error: `Sandbox unhealthy: ${failures.join("; ")}`,
  };
}

function printHealthySandbox(healthResult, sandboxInfo) {
  console.log("Health check passed.");
  console.log(`Workspace path: ${healthResult.sandboxPath}`);

  if (!sandboxInfo) {
    return;
  }

  console.log(`Database: ${sandboxInfo.dbType} (${sandboxInfo.dbContainer || "none"})`);
  console.log(`Backend container: ${sandboxInfo.backendContainer || "none"}`);
  console.log(`Frontend container: ${sandboxInfo.frontendContainer || "none"}`);
}

export function sandboxHealthRouter(state) {
  return state.sandboxHealthy ? "__end__" : "__end__";
}