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

import { createSandbox } from "../utils/sandboxManager.js";

export async function setupSandboxNode(state) {
  console.log("\n[Setup Sandbox] Creating project workspace...\n");

  const { folderStructure, dependencies, dbSchema } = state.blueprint;

  try {
    const sandboxId = await createSandbox(
      folderStructure,
      dependencies,
      dbSchema
    );

    console.log(`Sandbox created successfully: ${sandboxId}`);

    return {
      sandboxId,
      error: null,
    };
  } catch (error) {
    const message = `Sandbox creation failed: ${error.message}`;

    console.error(message);

    return {
      sandboxId: "",
      error: message,
    };
  }
}