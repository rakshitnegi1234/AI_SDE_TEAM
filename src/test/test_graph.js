/**
 * Phase 1 graph wiring test.
 *
 * Verifies only the requirement clarification flow:
 * START -> pmAgent -> humanInput -> pmAgent -> END
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

  const graph = buildPhase1Graph({
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
          currentPhase: "pm",
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
        currentPhase: "done",
      };
    },
    humanInputNode: () => {
      nodeOrder.push("humanInput");
      return {
        pmStatus: "idle",
        pmConversation: [{ role: "user", answers: "Anyone can use it." }],
      };
    },
  });

  const finalState = await graph.invoke(
    { userRequirement: "Build a test app" },
    { configurable: { thread_id: "phase-1-graph-test" } }
  );

  const expectedOrder = ["pmAgent", "humanInput", "pmAgent"];

  assert(
    nodeOrder.join(",") === expectedOrder.join(","),
    `Node order is ${expectedOrder.join(" -> ")}`
  );
  assert(finalState.pmStatus === "spec_ready", "PM finished with spec_ready");
  assert(finalState.currentPhase === "done", "Current phase is done");
  assert(finalState.clarifiedSpec?.appName === "test-app", "Clarified spec is stored");

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
