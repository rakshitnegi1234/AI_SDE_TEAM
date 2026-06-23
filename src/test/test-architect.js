/**
 * test-architect.js — Test Architect + Validator with real Gemini
 * Run: node tests/test-architect.js
 */

import "dotenv/config";
import { initGemini } from "../utils/gemini.js";
import {
  architectStep1Node, architectStep2Node, architectStep3Node,
  architectStep4Node, architectStep5Node,
} from "../agents/architectAgent.js";
import { blueprintValidatorNode } from "../agents/blueprintValidator.js";

console.log("\n🧪 TEST: Architect Agent + Blueprint Validator\n");

const MOCK_SPEC = {
  appName: "task-master",
  description: "Task management app with categories and due dates",
  userRoles: ["user"],
  authRequired: true,
  features: [
    { name: "Task Management", description: "CRUD tasks", subFeatures: ["due dates", "priority", "status"], userAccess: ["user"] },
    { name: "Categories", description: "Organize tasks", subFeatures: ["create", "assign", "filter"], userAccess: ["user"] },
    { name: "Auth", description: "Email/password login", subFeatures: ["register", "login", "logout"], userAccess: ["user"] },
  ],
  databaseRecommendation: "PostgreSQL",
  pages: [
    { name: "Login", route: "/login", requiresAuth: false },
    { name: "Dashboard", route: "/dashboard", requiresAuth: true },
    { name: "Categories", route: "/categories", requiresAuth: true },
  ],
};

async function runTest() {
  try {
    initGemini(process.env.GEMINI_API_KEY);
    console.log(`  ✅ Gemini initialized\n`);
  } catch (e) { console.error(`  ❌ ${e.message}`); process.exit(1); }

  let passed = 0, failed = 0;
  function assert(c, m) { if (c) { console.log(`  ✅ PASS: ${m}`); passed++; } else { console.log(`  ❌ FAIL: ${m}`); failed++; } }

  let state = {
    clarifiedSpec: MOCK_SPEC,
    blueprint: { entities: [], dbSchema: {}, apiEndpoints: [], frontendPages: [], folderStructure: "", dependencies: {} },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  // Helper: apply step result to state
  function applyResult(result) {
    if (result.blueprint) state.blueprint = { ...state.blueprint, ...result.blueprint };
  }

  // Step 1
  console.log("  ─── Step 1: Entities ───\n");
  applyResult(await architectStep1Node(state));
  assert(state.blueprint.entities?.length > 0, `${state.blueprint.entities.length} entities found`);

  // Step 2
  console.log("\n  ─── Step 2: DB Schema ───\n");
  applyResult(await architectStep2Node(state));
  assert(state.blueprint.dbSchema?.tables?.length > 0, `${state.blueprint.dbSchema.tables.length} tables`);

  // Step 3
  console.log("\n  ─── Step 3: API Endpoints ───\n");
  applyResult(await architectStep3Node(state));
  assert(state.blueprint.apiEndpoints?.length > 0, `${state.blueprint.apiEndpoints.length} endpoints`);

  // Step 4
  console.log("\n  ─── Step 4: Frontend Pages ───\n");
  applyResult(await architectStep4Node(state));
  assert(state.blueprint.frontendPages?.length > 0, `${state.blueprint.frontendPages.length} pages`);

  // Step 5
  console.log("\n  ─── Step 5: Folder Structure ───\n");
  applyResult(await architectStep5Node(state));
  assert(state.blueprint.folderStructure, "Folder structure generated");
  assert(state.blueprint.dependencies?.backend, "Backend deps defined");

  // Validator
  console.log("\n  ─── Blueprint Validator ───\n");
  const rv = await blueprintValidatorNode(state);
  assert(rv.blueprintValidation !== undefined, "Validator returned result");
  console.log(`  Validation: ${rv.blueprintValidation.isValid ? "✅ PASSED" : "❌ ISSUES"}`);

  console.log(`\n  ─── Summary: ${passed} passed, ${failed} failed ───\n`);
  if (failed > 0) process.exit(1);
}

runTest().catch(err => { console.error("  ❌", err.message); console.error(err.stack); process.exit(1); });
