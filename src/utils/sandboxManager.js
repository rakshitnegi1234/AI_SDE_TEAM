/**
 * sandboxManager.js
 *
 * Creates and manages a complete local development sandbox.
 *
 * Responsibilities:
 * - Create a local project workspace
 * - Initialize Git for snapshots and rollback
 * - Start Docker containers when Docker is available
 * - Start PostgreSQL or MongoDB depending on project dependencies
 * - Start backend and frontend Node.js containers
 * - Execute commands inside the correct container
 * - Read and write files in the sandbox
 * - Run health checks
 * - Reconnect an existing sandbox
 * - Destroy sandbox containers and local files
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const sandboxes = new Map();

const NETWORK_NAME = "aidev-network";
const DEFAULT_SANDBOX_DIR = "sandboxes";

let dockerAvailable = null;

/**
 * Checks whether Docker is installed and running.
 */
function isDockerAvailable() {
  if (dockerAvailable !== null) {
    return dockerAvailable;
  }

  try {
    execSync("docker info", {
      stdio: "pipe",
      timeout: 5000,
    });

    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
    console.warn("Docker is not available. Using local-only sandbox mode.");
  }

  return dockerAvailable;
}

/**
 * Runs a command inside a Docker container.
 */
function dockerExec(containerId, command, timeout = 30000) {
  try {
    const safeCommand = command.replace(/'/g, "'\\''");

    const stdout = execSync(
      `docker exec ${containerId} sh -c '${safeCommand}'`,
      {
        encoding: "utf-8",
        stdio: "pipe",
        timeout,
      }
    );

    return {
      stdout: stdout || "",
      stderr: "",
      exitCode: 0,
    };
  } catch (error) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
      exitCode: Number.isInteger(error.status) ? error.status : 1,
    };
  }
}

/**
 * Runs a command on the host machine.
 */
function runLocalCommand(command, options = {}) {
  try {
    const stdout = execSync(command, {
      encoding: "utf-8",
      stdio: "pipe",
      ...options,
    });

    return {
      stdout: stdout || "",
      stderr: "",
      exitCode: 0,
    };
  } catch (error) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
      exitCode: Number.isInteger(error.status) ? error.status : 1,
    };
  }
}

/**
 * Throws an error if a command failed.
 */
function assertCommand(result) {
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr || `Command failed with exit code ${result.exitCode}`
    );
  }

  return result;
}

/**
 * Creates the shared Docker network if it does not already exist.
 */
function ensureDockerNetwork() {
  try {
    execSync(`docker network inspect ${NETWORK_NAME}`, {
      stdio: "pipe",
    });
  } catch {
    console.log(`Creating Docker network: ${NETWORK_NAME}`);

    execSync(`docker network create ${NETWORK_NAME}`, {
      stdio: "pipe",
    });
  }
}

/**
 * Waits until a container responds to a health-check command.
 */
function waitForContainer(containerId, checkCommand, maxAttempts = 20) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = dockerExec(containerId, checkCommand, 5000);

    if (result.exitCode === 0) {
      return true;
    }

    execSync("sleep 1");
  }

  return false;
}

/**
 * Returns the base directory where all sandboxes are stored.
 */
function getSandboxBasePath() {
  return process.env.SANDBOX_DIR || path.join(process.cwd(), DEFAULT_SANDBOX_DIR);
}

/**
 * Detects database type from backend dependencies.
 *
 * If mongoose exists, MongoDB is used.
 * Otherwise, PostgreSQL is used by default.
 */
function detectDatabaseType(dependencies) {
  return dependencies?.backend?.dependencies?.mongoose ? "mongo" : "postgres";
}

/**
 * Creates standard backend and frontend folders.
 */
function createDefaultProjectFolders(sandboxPath) {
  const backendPath = path.join(sandboxPath, "backend");
  const frontendPath = path.join(sandboxPath, "frontend");

  fs.mkdirSync(backendPath, { recursive: true });
  fs.mkdirSync(frontendPath, { recursive: true });

  const backendDirs = [
    "src",
    "src/models",
    "src/routes",
    "src/controllers",
    "src/middleware",
    "src/config",
    "src/utils",
  ];

  const frontendDirs = [
    "src",
    "src/pages",
    "src/components",
    "src/hooks",
    "src/context",
    "src/utils",
  ];

  for (const dir of backendDirs) {
    fs.mkdirSync(path.join(backendPath, dir), { recursive: true });
  }

  for (const dir of frontendDirs) {
    fs.mkdirSync(path.join(frontendPath, dir), { recursive: true });
  }

  return {
    backendPath,
    frontendPath,
  };
}

/**
 * Creates extra folders from a text-based folder structure.
 */
function createFoldersFromBlueprint(sandboxPath, folderStructure) {
  if (typeof folderStructure !== "string") {
    return;
  }

  for (const line of folderStructure.split("\n")) {
    const match = line.match(/(?:├──|└──|│\s+[├└]──|\s+)\s*(.+)/);

    if (!match) {
      continue;
    }

    const item = match[1].trim().replace(/\/$/, "");

    const looksLikeFolder =
      item &&
      !item.includes(".") &&
      item.length < 100;

    if (!looksLikeFolder) {
      continue;
    }

    try {
      fs.mkdirSync(path.join(sandboxPath, item), {
        recursive: true,
      });
    } catch {
      // Ignore invalid folder paths from generated blueprint text.
    }
  }
}

/**
 * Initializes Git inside the sandbox.
 */
function initializeGitRepository(sandboxPath) {
  try {
    assertCommand(runLocalCommand("git init", { cwd: sandboxPath }));
    assertCommand(
      runLocalCommand('git config user.email "sandbox@example.com"', {
        cwd: sandboxPath,
      })
    );
    assertCommand(
      runLocalCommand('git config user.name "Sandbox"', {
        cwd: sandboxPath,
      })
    );
    assertCommand(runLocalCommand("git add -A", { cwd: sandboxPath }));
    assertCommand(
      runLocalCommand('git commit -m "Initial sandbox workspace" --allow-empty', {
        cwd: sandboxPath,
      })
    );
    assertCommand(runLocalCommand("git tag v0.0.0", { cwd: sandboxPath }));

    console.log("Git repository initialized.");
  } catch (error) {
    console.warn(`Git initialization failed: ${error.message}`);
  }
}

/**
 * Creates a database connection URL for containers on the same Docker network.
 */
function createDatabaseUrl(dbType, dbContainerName) {
  if (dbType === "mongo") {
    return `mongodb://${dbContainerName}:27017/appdb`;
  }

  return `postgresql://postgres:postgres@${dbContainerName}:5432/appdb`;
}

/**
 * Starts a PostgreSQL container.
 */
function startPostgresContainer(dbContainerName, volumeName) {
  const containerId = execSync(
    [
      "docker run -d",
      `--name ${dbContainerName}`,
      `--network ${NETWORK_NAME}`,
      `-v ${volumeName}:/var/lib/postgresql/data`,
      "-e POSTGRES_USER=postgres",
      "-e POSTGRES_PASSWORD=postgres",
      "-e POSTGRES_DB=appdb",
      "postgres:16-alpine",
    ].join(" "),
    {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60000,
    }
  ).trim();

  console.log(`PostgreSQL container started: ${containerId.slice(0, 12)}`);
  console.log("Waiting for PostgreSQL to be ready...");

  const isReady = waitForContainer(containerId, "pg_isready -U postgres", 30);

  if (isReady) {
    console.log("PostgreSQL is ready.");
  } else {
    console.warn("PostgreSQL may not be ready yet.");
  }

  return containerId;
}

/**
 * Starts a MongoDB container.
 */
function startMongoContainer(dbContainerName, volumeName) {
  const containerId = execSync(
    [
      "docker run -d",
      `--name ${dbContainerName}`,
      `--network ${NETWORK_NAME}`,
      `-v ${volumeName}:/data/db`,
      "-e MONGO_INITDB_DATABASE=appdb",
      "mongo:7",
    ].join(" "),
    {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60000,
    }
  ).trim();

  console.log(`MongoDB container started: ${containerId.slice(0, 12)}`);
  console.log("Waiting for MongoDB to be ready...");

  const isReady = waitForContainer(
    containerId,
    "mongosh --eval 'db.runCommand({ping:1})' --quiet",
    30
  );

  if (isReady) {
    console.log("MongoDB is ready.");
  } else {
    console.warn("MongoDB may not be ready yet.");
  }

  return containerId;
}

/**
 * Starts the database container.
 */
function startDatabaseContainer(dbType, dbContainerName, volumeName) {
  if (dbType === "mongo") {
    console.log("Starting MongoDB container...");
    return startMongoContainer(dbContainerName, volumeName);
  }

  console.log("Starting PostgreSQL container...");
  return startPostgresContainer(dbContainerName, volumeName);
}

/**
 * Creates PostgreSQL tables from the generated database schema.
 */
function createPostgresTables(dbContainerId, dbSchema) {
  if (!dbSchema) {
    return;
  }

  const sql = generateCreateTableSQL(dbSchema);

  if (!sql) {
    return;
  }

  console.log("Creating PostgreSQL tables...");

  const escapedSql = sql.replace(/'/g, "'\\''");

  const result = dockerExec(
    dbContainerId,
    `psql -U postgres -d appdb -c '${escapedSql}'`,
    15000
  );

  if (result.exitCode === 0) {
    console.log("Database tables created.");
  } else {
    console.warn(`Table creation warning: ${result.stderr.slice(0, 300)}`);
  }
}

/**
 * Starts the backend Node.js container.
 *
 * This container stays alive and waits for later commands.
 * It does not immediately start the backend server.
 */
function startBackendContainer({
  backendContainerName,
  sandboxPath,
  dbUrl,
}) {
  const containerId = execSync(
    [
      "docker run -d",
      `--name ${backendContainerName}`,
      `--network ${NETWORK_NAME}`,
      `-v "${sandboxPath}:/app"`,
      "-w /app",
      `-e DATABASE_URL=${dbUrl}`,
      "-e JWT_SECRET=dev-secret-change-in-production",
      "-e PORT=5000",
      "-e NODE_ENV=development",
      "node:20-slim",
      "tail -f /dev/null",
    ].join(" "),
    {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30000,
    }
  ).trim();

  console.log(`Backend container started: ${containerId.slice(0, 12)}`);
  console.log("Backend dependencies will install after backend/package.json exists.");

  return containerId;
}

/**
 * Starts the frontend Node.js container.
 *
 * This container stays alive and waits for later commands.
 * It does not immediately start the frontend dev server.
 */
function startFrontendContainer({
  frontendContainerName,
  backendContainerName,
  sandboxPath,
}) {
  const containerId = execSync(
    [
      "docker run -d",
      `--name ${frontendContainerName}`,
      `--network ${NETWORK_NAME}`,
      `-v "${sandboxPath}:/app"`,
      "-w /app",
      `-e VITE_API_URL=http://${backendContainerName}:5000/api`,
      "node:20-slim",
      "tail -f /dev/null",
    ].join(" "),
    {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30000,
    }
  ).trim();

  console.log(`Frontend container started: ${containerId.slice(0, 12)}`);
  console.log("Frontend dependencies will install after frontend/package.json exists.");

  return containerId;
}

/**
 * Creates a new sandbox.
 */
export async function createSandbox(folderStructure, dependencies, dbSchema) {
  const sandboxId = `sandbox-${Date.now()}`;
  const sandboxBase = getSandboxBasePath();
  const sandboxPath = path.join(sandboxBase, sandboxId);

  const canUseDocker = isDockerAvailable();

  console.log(`Creating sandbox workspace: ${sandboxPath}`);
  console.log(`Docker mode: ${canUseDocker ? "enabled" : "disabled"}`);

  fs.mkdirSync(sandboxPath, { recursive: true });

  const { backendPath, frontendPath } = createDefaultProjectFolders(sandboxPath);
  createFoldersFromBlueprint(sandboxPath, folderStructure);

  const dbType = detectDatabaseType(dependencies);

  const dbContainerName = `aidev-db-${sandboxId}`;
  const backendContainerName = `aidev-backend-${sandboxId}`;
  const frontendContainerName = `aidev-frontend-${sandboxId}`;
  const volumeName = `aidev-dbdata-${sandboxId}`;

  const dbUrl = createDatabaseUrl(dbType, dbContainerName);

  console.log("Workspace folders created.");
  console.log("Application files will be generated by the AI coding loop.");

  initializeGitRepository(sandboxPath);

  let dbContainerId = null;
  let backendContainerId = null;
  let frontendContainerId = null;

  if (canUseDocker) {
    try {
      ensureDockerNetwork();

      dbContainerId = startDatabaseContainer(
        dbType,
        dbContainerName,
        volumeName
      );

      if (dbType === "postgres") {
        createPostgresTables(dbContainerId, dbSchema);
      }

      if (dbType === "mongo" && dbSchema) {
        console.log("MongoDB collections will be created on first insert.");
      }

      backendContainerId = startBackendContainer({
        backendContainerName,
        sandboxPath,
        dbUrl,
      });

      frontendContainerId = startFrontendContainer({
        frontendContainerName,
        backendContainerName,
        sandboxPath,
      });
    } catch (error) {
      console.warn(`Docker setup failed: ${error.message}`);
      console.warn("Continuing in local-only mode.");
    }
  }

  sandboxes.set(sandboxId, {
    path: sandboxPath,
    backendPath,
    frontendPath,
    dbType,
    dbContainerId,
    backendContainerId,
    frontendContainerId,
    dbContainerName,
    backendContainerName,
    frontendContainerName,
    dockerAvailable: canUseDocker,
    createdAt: Date.now(),
    snapshotCount: 0,
  });

  return sandboxId;
}

/**
 * Reconnects to an existing sandbox folder.
 *
 * Useful when project files still exist on disk, but Docker containers were stopped
 * or removed.
 */
export async function reconnectSandbox(sandboxId) {
  const sandboxBase = getSandboxBasePath();
  const sandboxPath = path.join(sandboxBase, sandboxId);

  console.log(`Reconnecting sandbox: ${sandboxId}`);

  if (!fs.existsSync(sandboxPath)) {
    console.error(`Sandbox folder not found: ${sandboxPath}`);
    return false;
  }

  const backendPath = path.join(sandboxPath, "backend");
  const frontendPath = path.join(sandboxPath, "frontend");

  const dependencies = readBackendDependencies(backendPath);
  const dbType = detectDatabaseType(dependencies);

  const dbContainerName = `aidev-db-${sandboxId}`;
  const backendContainerName = `aidev-backend-${sandboxId}`;
  const frontendContainerName = `aidev-frontend-${sandboxId}`;
  const volumeName = `aidev-dbdata-${sandboxId}`;

  const dbUrl = createDatabaseUrl(dbType, dbContainerName);

  if (!isDockerAvailable()) {
    console.warn("Docker is not available. Cannot reconnect containers.");
    return false;
  }

  removeExistingContainers([
    dbContainerName,
    backendContainerName,
    frontendContainerName,
  ]);

  try {
    ensureDockerNetwork();

    const dbContainerId = startDatabaseContainer(
      dbType,
      dbContainerName,
      volumeName
    );

    const backendContainerId = startBackendContainer({
      backendContainerName,
      sandboxPath,
      dbUrl,
    });

    console.log("Installing backend dependencies...");
    dockerExec(
      backendContainerId,
      "cd /app/backend && npm install 2>&1",
      120000
    );
    console.log("Backend dependencies installed.");

    const frontendContainerId = startFrontendContainer({
      frontendContainerName,
      backendContainerName,
      sandboxPath,
    });

    console.log("Installing frontend dependencies...");
    dockerExec(
      frontendContainerId,
      "cd /app/frontend && npm install 2>&1",
      120000
    );
    console.log("Frontend dependencies installed.");

    sandboxes.set(sandboxId, {
      path: sandboxPath,
      backendPath,
      frontendPath,
      dbType,
      dbContainerId,
      backendContainerId,
      frontendContainerId,
      dbContainerName,
      backendContainerName,
      frontendContainerName,
      dockerAvailable: true,
      createdAt: Date.now(),
      snapshotCount: 0,
    });

    console.log("Sandbox reconnected successfully.");
    return true;
  } catch (error) {
    console.error(`Sandbox reconnect failed: ${error.message}`);
    return false;
  }
}

/**
 * Reads backend/package.json dependencies.
 */
function readBackendDependencies(backendPath) {
  try {
    const packageJsonPath = path.join(backendPath, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

    return {
      backend: {
        dependencies: packageJson.dependencies || {},
      },
    };
  } catch {
    return {
      backend: {
        dependencies: {},
      },
    };
  }
}

/**
 * Removes stale containers by name.
 */
function removeExistingContainers(containerNames) {
  for (const name of containerNames) {
    try {
      execSync(`docker rm -f ${name}`, {
        stdio: "pipe",
        timeout: 5000,
      });
    } catch {
      // Container does not exist. Nothing to remove.
    }
  }
}

/**
 * Generates PostgreSQL CREATE TABLE SQL from dbSchema.
 */
function generateCreateTableSQL(dbSchema) {
  if (!dbSchema?.tables?.length) {
    return null;
  }

  const statements = [];

  for (const table of dbSchema.tables) {
    const fields = (table.fields || []).map((field) => {
      const constraints = (field.constraints || []).join(" ");

      return `  ${field.name} ${field.type || "TEXT"} ${constraints}`.trimEnd();
    });

    if (fields.length === 0) {
      continue;
    }

    const createTableSql =
      `CREATE TABLE IF NOT EXISTS ${table.name} (\n` +
      `${fields.join(",\n")}\n` +
      ");";

    statements.push(createTableSql);
  }

  for (const table of dbSchema.tables) {
    for (const index of table.indexes || []) {
      const indexName = `idx_${table.name}_${index.replace(/,/g, "_")}`;

      statements.push(
        `CREATE INDEX IF NOT EXISTS ${indexName} ON ${table.name} (${index});`
      );
    }
  }

  return statements.join("\n");
}

/**
 * Checks whether a sandbox is healthy.
 */
export async function healthCheck(sandboxId) {
  const sandbox = sandboxes.get(sandboxId);

  if (!sandbox) {
    return {
      healthy: false,
      failures: ["Sandbox not found"],
    };
  }

  const failures = [];

  checkRequiredDirectories(sandbox, failures);
  checkGitRepository(sandbox, failures);
  checkDatabaseContainer(sandbox, failures);
  checkApplicationContainers(sandbox, failures);
  printPostgresTables(sandbox);

  return {
    healthy: failures.length === 0,
    failures,
    sandboxPath: sandbox.path,
    dockerEnabled: Boolean(sandbox.backendContainerId),
  };
}

function checkRequiredDirectories(sandbox, failures) {
  if (!fs.existsSync(sandbox.backendPath)) {
    failures.push("Backend directory missing");
  }

  if (!fs.existsSync(sandbox.frontendPath)) {
    failures.push("Frontend directory missing");
  }
}

function checkGitRepository(sandbox, failures) {
  try {
    assertCommand(runLocalCommand("git status", { cwd: sandbox.path }));
  } catch {
    failures.push("Git repository not initialized");
  }
}

function checkDatabaseContainer(sandbox, failures) {
  if (!sandbox.dbContainerId) {
    return;
  }

  if (sandbox.dbType === "postgres") {
    const result = dockerExec(
      sandbox.dbContainerId,
      "pg_isready -U postgres",
      5000
    );

    if (result.exitCode !== 0) {
      failures.push("PostgreSQL is not responding");
    }

    return;
  }

  const result = dockerExec(
    sandbox.dbContainerId,
    "mongosh --eval 'db.runCommand({ping:1})' --quiet",
    5000
  );

  if (result.exitCode !== 0) {
    failures.push("MongoDB is not responding");
  }
}

function checkApplicationContainers(sandbox, failures) {
  if (!sandbox.dockerAvailable) {
    return;
  }

  if (!sandbox.backendContainerId) {
    failures.push("Backend container missing");
  } else {
    const result = dockerExec(sandbox.backendContainerId, "node --version", 5000);

    if (result.exitCode !== 0) {
      failures.push("Backend container is not responding");
    }
  }

  if (!sandbox.frontendContainerId) {
    failures.push("Frontend container missing");
  } else {
    const result = dockerExec(sandbox.frontendContainerId, "node --version", 5000);

    if (result.exitCode !== 0) {
      failures.push("Frontend container is not responding");
    }
  }
}

function printPostgresTables(sandbox) {
  if (!sandbox.dbContainerId || sandbox.dbType !== "postgres") {
    return;
  }

  const result = dockerExec(
    sandbox.dbContainerId,
    `psql -U postgres -d appdb -c "SELECT tablename FROM pg_tables WHERE schemaname='public'" -t`,
    5000
  );

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return;
  }

  const tables = result.stdout
    .trim()
    .split("\n")
    .map((table) => table.trim())
    .filter(Boolean);

  console.log(`Tables found: ${tables.join(", ")}`);
}

/**
 * Writes a file into the sandbox.
 */
export function writeFile(sandboxId, filePath, content) {
  const sandbox = getRequiredSandbox(sandboxId);

  const fullPath = path.join(sandbox.path, filePath);

  fs.mkdirSync(path.dirname(fullPath), {
    recursive: true,
  });

  fs.writeFileSync(fullPath, content, "utf-8");
}

/**
 * Reads a file from the sandbox.
 */
export function readFile(sandboxId, filePath) {
  const sandbox = getRequiredSandbox(sandboxId);

  const fullPath = path.join(sandbox.path, filePath);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Returns all files in the sandbox, excluding node_modules and .git.
 */
export function getFileList(sandboxId) {
  const sandbox = getRequiredSandbox(sandboxId);

  const files = [];

  walkFiles(sandbox.path, "", files);

  return files;
}

function walkFiles(currentDir, prefix, files) {
  const entries = fs.readdirSync(currentDir, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      walkFiles(fullPath, relativePath, files);
    } else {
      files.push(relativePath);
    }
  }
}

/**
 * Executes a command inside the correct sandbox environment.
 *
 * Backend commands run inside the backend container.
 * Frontend commands run inside the frontend container.
 * If Docker is unavailable, the command runs locally in the sandbox folder.
 */
export function executeCommand(sandboxId, command, timeout = 30000) {
  const sandbox = getRequiredSandbox(sandboxId);

  if (isBackendCommand(command) && sandbox.backendContainerId) {
    return dockerExec(sandbox.backendContainerId, command, timeout);
  }

  if (isFrontendCommand(command) && sandbox.frontendContainerId) {
    return dockerExec(sandbox.frontendContainerId, command, timeout);
  }

  if (sandbox.backendContainerId) {
    return dockerExec(sandbox.backendContainerId, command, timeout);
  }

  return runLocalCommand(command, {
    cwd: sandbox.path,
    timeout,
  });
}

function isBackendCommand(command) {
  return command.includes("/app/backend") || command.includes("cd /app/backend");
}

function isFrontendCommand(command) {
  return command.includes("/app/frontend") || command.includes("cd /app/frontend");
}

/**
 * Creates a Git snapshot and tag.
 */
export function snapshot(sandboxId, message) {
  const sandbox = getRequiredSandbox(sandboxId);

  sandbox.snapshotCount += 1;

  const tag = `v0.${sandbox.snapshotCount}.0`;

  try {
    assertCommand(runLocalCommand("git add -A", { cwd: sandbox.path }));
    assertCommand(
      runLocalCommand('git config user.email "sandbox@example.com"', {
        cwd: sandbox.path,
      })
    );
    assertCommand(
      runLocalCommand('git config user.name "Sandbox"', {
        cwd: sandbox.path,
      })
    );
    assertCommand(
      runLocalCommand(`git commit -m "${message}" --allow-empty`, {
        cwd: sandbox.path,
      })
    );
    assertCommand(runLocalCommand(`git tag ${tag}`, { cwd: sandbox.path }));

    return {
      success: true,
      tag,
      message,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Rolls the sandbox files back to a previous Git tag.
 */
export function rollback(sandboxId, tag) {
  const sandbox = getRequiredSandbox(sandboxId);

  try {
    assertCommand(runLocalCommand(`git checkout ${tag}`, { cwd: sandbox.path }));

    return {
      success: true,
      rolledBackTo: tag,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Returns the local sandbox path.
 */
export function getSandboxPath(sandboxId) {
  return sandboxes.get(sandboxId)?.path || null;
}

/**
 * Returns human-readable sandbox information.
 */
export function getSandboxInfo(sandboxId) {
  const sandbox = sandboxes.get(sandboxId);

  if (!sandbox) {
    return null;
  }

  return {
    path: sandbox.path,
    dockerEnabled: Boolean(sandbox.backendContainerId),
    dockerAvailable: Boolean(sandbox.dockerAvailable),
    containerId: sandbox.backendContainerId?.slice(0, 12) || null,
    dbType: sandbox.dbType,
    dbContainer: sandbox.dbContainerId?.slice(0, 12) || null,
    backendContainer: sandbox.backendContainerId?.slice(0, 12) || null,
    frontendContainer: sandbox.frontendContainerId?.slice(0, 12) || null,
  };
}

/**
 * Destroys a sandbox.
 *
 * This removes:
 * - Database container
 * - Backend container
 * - Frontend container
 * - Local sandbox folder
 */
export function destroySandbox(sandboxId) {
  const sandbox = sandboxes.get(sandboxId);

  if (!sandbox) {
    return;
  }

  const containers = [
    sandbox.dbContainerId,
    sandbox.backendContainerId,
    sandbox.frontendContainerId,
  ];

  for (const containerId of containers) {
    if (!containerId) {
      continue;
    }

    try {
      runLocalCommand(`docker rm -f ${containerId}`, {
        timeout: 10000,
      });
    } catch {
      // Best-effort cleanup.
    }
  }

  console.log("Sandbox containers removed.");

  try {
    fs.rmSync(sandbox.path, {
      recursive: true,
      force: true,
    });
  } catch {
    // Best-effort cleanup.
  }

  sandboxes.delete(sandboxId);
}

/**
 * Returns sandbox info or throws a clear error.
 */
function getRequiredSandbox(sandboxId) {
  const sandbox = sandboxes.get(sandboxId);

  if (!sandbox) {
    throw new Error(`Sandbox ${sandboxId} not found`);
  }

  return sandbox;
}