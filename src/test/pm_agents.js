/**
 * pm_agents.js - PM Agent tests.
 *
 * Default mode is offline and validates the PM node's response handling without
 * calling the external Gemini API. Set GEMINI_RUN_REAL_TESTS=1 to run the
 * integration path against the configured API.
 */

import { pmAgentNode } from "../agents/pmAgent.js";
import { initGemini } from "../utils/gemini.js";

console.log("\nTEST: PM Agent\n");

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

function baseState(overrides = {}) {
  return {
    userRequirement: "Build me a todo app",
    pmStatus: "idle",
    pmQuestions: [],
    pmConversation: [],
    ...overrides,
  };
}

async function runOfflineTests() {
  console.log("  Offline mode: verifying PM failure handling without API access\n");

  const result = await pmAgentNode(baseState());

  assert(result.pmStatus === "failed", `PM reports failed status when client is not initialized: ${result.pmStatus}`);
  assert(typeof result.error === "string" && result.error.includes("Gemini client is not initialized"), "Failure reason is exposed");

  printSummary();
}

async function runRealApiTests() {
  console.log("  Real API mode: GEMINI_RUN_REAL_TESTS=1\n");

  try {
    initGemini(process.env.GEMINI_API_KEY);
    console.log(`  Gemini initialized (${process.env.GEMINI_MODEL || "default model"})\n`);
  } catch (error) {
    console.error(`  FAIL: ${error.message}`);
    process.exit(1);
  }

  const result1 = await pmAgentNode(baseState());

  assert(
    result1.pmStatus === "needs_clarification" || result1.pmStatus === "spec_ready",
    `Valid status: ${result1.pmStatus}`
  );

  if (result1.pmStatus === "needs_clarification") {
    assert(result1.pmQuestions.length > 0, `Generated ${result1.pmQuestions.length} questions`);

    const result2 = await pmAgentNode(baseState({
      pmConversation: [
        { role: "pm", questions: result1.pmQuestions },
        { role: "user", answers: "Categories, due dates, priority. Yes auth. Single user role. Clean UI." },
      ],
    }));

    assert(result2.pmStatus === "spec_ready", `Second call produced spec_ready: ${result2.pmStatus}`);
    assert(result2.clarifiedSpec !== null, "Spec generated");
  }

  printSummary();
}

function printSummary() {
  console.log(`\n  Summary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

if (process.env.GEMINI_RUN_REAL_TESTS === "1") {
  runRealApiTests().catch((error) => {
    console.error("  FAIL", error.message);
    process.exit(1);
  });
} else {
  runOfflineTests().catch((error) => {
    console.error("  FAIL", error.message);
    process.exit(1);
  });
}
