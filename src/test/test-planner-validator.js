import {
  plannerValidatorNode,
  plannerValidatorRouter,
} from "../agents/plannerValidator.js";

console.log("\nTEST: Planner Validator\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

const blueprint = {
  entities: [
    {
      name: "Task",
      modelFile: "task",
      routeFile: "taskRoutes",
    },
  ],
  folderStructure: [
    "backend/",
    "  package.json",
    "  src/",
    "    index.js",
    "    models/",
    "      task.js",
    "    routes/",
      "      taskRoutes.js",
    "frontend/",
    "  package.json",
    "  src/",
    "    App.jsx",
    "README.md",
  ].join("\n"),
};

function baseState(taskQueue, plannerValidation = undefined) {
  return {
    blueprint,
    taskQueue,
    plannerValidation,
  };
}

function validTaskQueue() {
  return {
    phases: [
      {
        phaseNumber: 1,
        phaseName: "setup",
        tasks: [
          {
            taskId: "setup-1",
            filesToCreate: [
              "backend/package.json",
              "backend/src/index.js",
              "frontend/package.json",
              "frontend/src/App.jsx",
            ],
            filesNeeded: [],
          },
        ],
      },
      {
        phaseNumber: 2,
        phaseName: "models",
        tasks: [
          {
            taskId: "models-1",
            filesToCreate: ["backend/src/models/task.js"],
            filesNeeded: [],
          },
        ],
      },
      {
        phaseNumber: 3,
        phaseName: "backend",
        tasks: [
          {
            taskId: "backend-1",
            filesToCreate: ["backend/src/routes/taskRoutes.js"],
            filesNeeded: ["backend/src/models/task.js"],
          },
        ],
      },
      {
        phaseNumber: 4,
        phaseName: "integration",
        tasks: [
          {
            taskId: "integration-1",
            title: "Wire backend and frontend entrypoints",
            filesToCreate: ["backend/src/index.js", "frontend/src/App.jsx"],
            filesNeeded: [
              "backend/src/index.js",
              "backend/src/routes/taskRoutes.js",
              "frontend/src/App.jsx",
            ],
          },
        ],
      },
      {
        phaseNumber: 5,
        phaseName: "documentation",
        tasks: [
          {
            taskId: "documentation-1",
            filesToCreate: ["README.md"],
            filesNeeded: [],
          },
        ],
      },
    ],
  };
}

function invalidTaskQueue() {
  return {
    phases: [
      {
        phaseNumber: 1,
        phaseName: "setup",
        tasks: [
          {
            taskId: "setup-1",
            filesToCreate: ["backend/package.json"],
            filesNeeded: [],
          },
        ],
      },
    ],
  };
}

function runTest() {
  const validResult = plannerValidatorNode(baseState(validTaskQueue()));

  assert(validResult.plannerValidation.isValid === true, "Valid plan passes");
  assert(plannerValidatorRouter(validResult) === "setupSandbox", "Valid plan routes to setupSandbox");

  const invalidResult = plannerValidatorNode(baseState(invalidTaskQueue()));

  assert(invalidResult.plannerValidation.isValid === false, "Invalid plan fails");
  assert(
    invalidResult.plannerValidation.issues.some((issue) => issue.type === "missing_entity_model_task"),
    "Invalid plan reports missing entity model task"
  );
  assert(plannerValidatorRouter(invalidResult) === "plannerAgent", "First invalid plan routes back to plannerAgent");

  const finalInvalidResult = plannerValidatorNode(baseState(
    invalidTaskQueue(),
    invalidResult.plannerValidation
  ));

  assert(
    plannerValidatorRouter(finalInvalidResult) === "__end__",
    "Second invalid plan ends instead of creating sandbox"
  );

  printSummary();
}

function printSummary() {
  console.log(`\n  Summary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTest();
