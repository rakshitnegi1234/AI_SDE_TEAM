/**
 * setupSandbox.js
 * Creates a complete Docker-based project environment.
 *
 * The Architect's dbSchema is passed to sandboxManager so that:
 * - The correct database container image is used
 * - Tables are created from the schema
 * - The backend receives DATABASE_URL
 * - The frontend receives VITE_API_URL
 */

import {
  createSandbox,
  getSandboxInfo,
  healthCheck,
} from "../utils/sandboxManager.js";

export async function setupSandboxNode(state) {

  console.log("\n[Setup Sandbox] Creating project workspace\n");
  const { folderStructure, dependencies, dbSchema } = state.blueprint;

  try {
    const sandboxId = await createSandbox(
      folderStructure,
      dependencies,
      dbSchema
    );

    console.log(`Sandbox created successfully: ${sandboxId}`);

    const healthResult = await healthCheck(sandboxId);
    const sandboxInfo = getSandboxInfo(sandboxId);

    if (!healthResult.healthy) {
      const failures = healthResult.failures || [];
      const message = `Sandbox unhealthy: ${failures.join("; ")}`;

      console.error(message);

      return {
        sandboxId,
        sandboxHealthy: false,
        error: message,
      };
    }

    printHealthySandbox(healthResult, sandboxInfo);

    return {
      sandboxId,
      sandboxHealthy: true,
      sandboxRuntime: buildSandboxRuntime(sandboxInfo),
      error: null,
    };
  } catch (error) {
    const message = `Sandbox creation failed: ${error.message}`;

    console.error(message);

    return {
      sandboxId: "",
      sandboxHealthy: false,
      error: message,
    };
  }
}

function buildSandboxRuntime(sandboxInfo) {
  return {
    dockerEnabled: Boolean(sandboxInfo?.dockerEnabled),
    backendUrl: sandboxInfo?.backendUrl || "",
    frontendUrl: sandboxInfo?.frontendUrl || "",
    backendPort: sandboxInfo?.backendPort || null,
    frontendPort: sandboxInfo?.frontendPort || null,
    frontendEnv: {
      VITE_API_BASE_URL: sandboxInfo?.backendUrl || "",
      VITE_API_URL: sandboxInfo?.backendUrl || "",
    },
    backendEnv: {
      PORT: "5000",
      DATABASE_URL: "provided by sandbox",
      JWT_SECRET: "provided by sandbox when auth is used",
    },
  };
}

function printHealthySandbox(healthResult, sandboxInfo) {
  console.log("Sandbox health check passed.");
  console.log(`Workspace path: ${healthResult.sandboxPath}`);

  if (!sandboxInfo) {
    return;
  }

  console.log(`Database: ${sandboxInfo.dbType} (${sandboxInfo.dbContainer || "none"})`);
  console.log(`Backend container: ${sandboxInfo.backendContainer || "none"}`);
  console.log(`Frontend container: ${sandboxInfo.frontendContainer || "none"}`);
}
