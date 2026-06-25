/**
 * Phase 1 graph wiring test.
 *
 * Verifies the merged Phase 1 + Phase 2 + Phase 3 flow:
 * START -> pmAgent -> humanInput -> pmAgent -> architect steps -> validator
 * -> planner -> plannerValidator -> setupSandbox -> sandboxHealthCheck -> END
 */

import { MemorySaver } from "@langchain/langgraph";
import { buildPhase1Graph } from "../config/graph.js";

console.log("\nTEST: Phase 1 Graph\n");

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

async function runTest() {
  const nodeOrder = [];

  const graph = await buildPhase1Graph({
    checkpointer: new MemorySaver(),
    pmAgentNode: (state) => {
      nodeOrder.push("pmAgent");

      if (state.pmConversation.length === 0) {
        return {
          pmStatus: "needs_clarification",
          pmQuestions: ["Who can use the app?"],
          pmConversation: [{
            role: "pm",
            questions: ["Who can use the app?"],
          }],
        };
      }

      return {
        pmStatus: "spec_ready",
        clarifiedSpec: {
          appName: "test-app",
          description: "A clarified phase 1 spec.",
          userRoles: ["user"],
          authRequired: false,
          features: [],
          pages: [],
          assumptions: [],
        },
        pmConversation: [{ role: "pm", spec: { appName: "test-app" } }],
      };
    },
    humanInputNode: () => {
      nodeOrder.push("humanInput");
      return {
        pmStatus: "idle",
        pmConversation: [{ role: "user", answers: "Anyone can use it." }],
      };
    },
    architectStep1Node: () => {
      nodeOrder.push("architectStep1");
      return {
        blueprint: { entities: [{ name: "User" }] },
      };
    },
    architectStep2Node: () => {
      nodeOrder.push("architectStep2");
      return {
        blueprint: {
          dbSchema: {
            databaseType: "PostgreSQL",
            tables: [{ name: "users", fields: [{ name: "id" }], foreignKeys: [] }],
          },
        },
      };
    },
    architectStep3Node: () => {
      nodeOrder.push("architectStep3");
      return {
        blueprint: {
          apiEndpoints: [
            { method: "GET", path: "/api/v1/users", relatedTable: "users", requiresAuth: false },
          ],
        },
      };
    },
    architectStep4Node: () => {
      nodeOrder.push("architectStep4");
      return {
        blueprint: {
          frontendPages: [
            {
              name: "Home",
              route: "/",
              requiresAuth: false,
              components: [{ name: "UserList", apiCalls: ["GET /api/v1/users"] }],
            },
          ],
        },
      };
    },
    architectStep5Node: () => {
      nodeOrder.push("architectStep5");
      return {
        blueprint: {
          folderStructure: "backend/\nfrontend/",
          dependencies: { backend: {}, frontend: {} },
        },
      };
    },
    blueprintValidatorNode: () => {
      nodeOrder.push("blueprintValidator");
      return {
        blueprintValidation: {
          isValid: true,
          issues: [],
          validationCycles: 1,
        },
      };
    },
    blueprintValidatorRouter: () => "__end__",
    plannerAgentNode: () => {
      nodeOrder.push("plannerAgent");
      return {
        taskQueue: {
          phases: [{ phaseName: "setup", tasks: [{ taskId: "setup-1" }] }],
          totalTasks: 1,
        },
        currentPhaseIndex: 0,
        currentTaskIndex: 0,
      };
    },
    plannerValidatorNode: () => {
      nodeOrder.push("plannerValidator");
      return {
        plannerValidation: {
          isValid: true,
          issues: [],
          validationCycles: 1,
        },
      };
    },
    setupSandboxNode: () => {
      nodeOrder.push("setupSandbox");
      return {
        sandboxId: "sandbox-test",
        fileRegistry: [{ path: "backend/src/index.js", exports: ["app"] }],
      };
    },
    sandboxHealthCheckNode: () => {
      nodeOrder.push("sandboxHealthCheck");
      return {
        sandboxHealthy: true,
      };
    },
  });

  const finalState = await graph.invoke(
    { userRequirement: "Build a test app" },
    { configurable: { thread_id: "phase-1-graph-test" } }
  );

  const expectedOrder = [
    "pmAgent",
    "humanInput",
    "pmAgent",
    "architectStep1",
    "architectStep2",
    "architectStep3",
    "architectStep4",
    "architectStep5",
    "blueprintValidator",
    "plannerAgent",
    "plannerValidator",
    "setupSandbox",
    "sandboxHealthCheck",
  ];

  assert(
    nodeOrder.join(",") === expectedOrder.join(","),
    `Node order is ${expectedOrder.join(" -> ")}`
  );
  assert(finalState.pmStatus === "spec_ready", "PM finished with spec_ready");
  assert(finalState.clarifiedSpec?.appName === "test-app", "Clarified spec is stored");
  assert(finalState.blueprintValidation?.isValid === true, "Blueprint validation is stored");
  assert(finalState.plannerValidation?.isValid === true, "Planner validation is stored");
  assert(finalState.taskQueue?.totalTasks === 1, "Planner task queue is stored");
  assert(finalState.sandboxId === "sandbox-test", "Sandbox ID is stored");
  assert(finalState.sandboxHealthy === true, "Sandbox health is stored");

  printSummary();
}

function printSummary() {
  console.log(`\n  Summary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTest().catch((error) => {
  console.error("  FAIL", error.message);
  console.error(error.stack);
  process.exit(1);
});
