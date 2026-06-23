/**
 * test-validator.js — Test Blueprint Validator (no API needed)
 * 
 * Run: node tests/test-validator.js
 * 
 * Tests the validator with INTENTIONALLY BROKEN blueprints.
 * No Gemini API needed — pure logic test.
 * 
 * Verifies:
 * 1. Catches missing tables for entities
 * 2. Catches invalid foreign keys
 * 3. Catches orphan API endpoints (reference non-existent tables)
 * 4. Catches pages calling non-existent APIs
 * 5. Catches auth mismatches
 * 6. Passes a clean blueprint with zero issues
 * 7. Force proceeds after max validation cycles
 */

import {
  blueprintValidatorNode,
  blueprintValidatorRouter,
} from "../agents/blueprintValidator.js";

console.log("\n🧪 TEST: Blueprint Validator (No API needed)\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { console.log(`  ✅ PASS: ${message}`); passed++; }
  else { console.log(`  ❌ FAIL: ${message}`); failed++; }
}

// ─── TEST 1: Catches missing table ──────────────────────────

async function test1() {
  console.log("  ─── Test 1: Missing table for entity ───\n");

  const state = {
    blueprint: {
      entities: [
        { name: "User", description: "A user" },
        { name: "Task", description: "A task" },
        { name: "Comment", description: "A comment" }, // No table for this!
      ],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [
          { name: "users", fields: [{ name: "id" }], foreignKeys: [] },
          { name: "tasks", fields: [{ name: "id" }], foreignKeys: [] },
          // No "comments" table!
        ],
      },
      apiEndpoints: [],
      frontendPages: [],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  const hasIssue = result.blueprintValidation.issues.some(i => 
    i.type === "missing_table" && i.message.includes("Comment")
  );
  assert(hasIssue, "Detected missing table for 'Comment' entity");
}

// ─── TEST 2: Catches invalid foreign key ────────────────────

async function test2() {
  console.log("\n  ─── Test 2: Invalid foreign key ───\n");

  const state = {
    blueprint: {
      entities: [],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [
          {
            name: "tasks",
            fields: [{ name: "id" }, { name: "category_id" }],
            foreignKeys: [
              { field: "category_id", references: "ghost_table(id)", onDelete: "CASCADE" },
            ],
          },
        ],
      },
      apiEndpoints: [],
      frontendPages: [],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  const hasIssue = result.blueprintValidation.issues.some(i => 
    i.type === "invalid_foreign_key" && i.message.includes("ghost_table")
  );
  assert(hasIssue, "Detected FK referencing non-existent table 'ghost_table'");
}

// ─── TEST 3: Catches orphan endpoint ────────────────────────

async function test3() {
  console.log("\n  ─── Test 3: Orphan API endpoint ───\n");

  const state = {
    blueprint: {
      entities: [],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [
          { name: "users", fields: [{ name: "id" }], foreignKeys: [] },
        ],
      },
      apiEndpoints: [
        { method: "GET", path: "/api/tasks", relatedTable: "tasks", requiresAuth: true },
        // "tasks" table doesn't exist!
      ],
      frontendPages: [],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  const hasIssue = result.blueprintValidation.issues.some(i => 
    i.type === "orphan_endpoint" && i.message.includes("tasks")
  );
  assert(hasIssue, "Detected API endpoint referencing non-existent table 'tasks'");
}

// ─── TEST 4: Passes a clean blueprint ───────────────────────

async function test4() {
  console.log("\n  ─── Test 4: Clean blueprint passes ───\n");

  const state = {
    blueprint: {
      entities: [
        { name: "User", description: "A user" },
        { name: "Task", description: "A task" },
      ],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [
          {
            name: "users",
            fields: [{ name: "id" }, { name: "email" }],
            foreignKeys: [],
          },
          {
            name: "tasks",
            fields: [{ name: "id" }, { name: "user_id" }],
            foreignKeys: [{ field: "user_id", references: "users(id)", onDelete: "CASCADE" }],
          },
        ],
      },
      apiEndpoints: [
        { method: "GET", path: "/api/users", relatedTable: "users", requiresAuth: true },
        { method: "GET", path: "/api/tasks", relatedTable: "tasks", requiresAuth: true },
      ],
      frontendPages: [
        {
          name: "Dashboard",
          route: "/dashboard",
          requiresAuth: true,
          components: [
            { name: "TaskList", description: "Shows tasks", apiCalls: ["/api/tasks"] },
          ],
        },
      ],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  assert(result.blueprintValidation.isValid === true, "Clean blueprint passes validation");
  assert(
    result.blueprintValidation.issues.length === 0,
    `Zero issues found (got ${result.blueprintValidation.issues.length})`
  );
}

// ─── TEST 5: Force proceed after max cycles ─────────────────

async function test5() {
  console.log("\n  ─── Test 5: Force proceed after max cycles ───\n");

  const state = {
    blueprint: {
      entities: [{ name: "Ghost", description: "No table" }],
      dbSchema: { databaseType: "PostgreSQL", tables: [] },
      apiEndpoints: [],
      frontendPages: [],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 2 }, // Already at max
  };

  const result = await blueprintValidatorNode(state);
  assert(result.blueprintValidation.isValid === true, "Force proceeds after max cycles");
  assert(result.blueprintValidation.validationCycles === 3, "Cycle count incremented");
}

// ─── TEST 6: Router returns correct targets ─────────────────

async function test6() {
  console.log("\n  ─── Test 6: Router returns correct targets ───\n");

  const validState = {
    blueprintValidation: { isValid: true, issues: [] },
  };
  assert(blueprintValidatorRouter(validState) === "__end__", "Valid → __end__");

  const dbErrorState = {
    blueprintValidation: {
      isValid: false,
      issues: [{ severity: "error", fixTarget: "architectStep2", message: "DB issue" }],
    },
  };
  assert(blueprintValidatorRouter(dbErrorState) === "architectStep2", "DB error → architectStep2");

  const apiErrorState = {
    blueprintValidation: {
      isValid: false,
      issues: [{ severity: "error", fixTarget: "architectStep3", message: "API issue" }],
    },
  };
  assert(blueprintValidatorRouter(apiErrorState) === "architectStep3", "API error → architectStep3");

  const pageErrorState = {
    blueprintValidation: {
      isValid: false,
      issues: [{ severity: "warning", fixTarget: "architectStep4", message: "Page issue" }],
    },
  };
  assert(blueprintValidatorRouter(pageErrorState) === "architectStep4", "Page warning → architectStep4");
}

// ─── RUN ALL ─────────────────────────────────────────────────

async function runAll() {
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();

  console.log(`\n  ─── Summary: ${passed} passed, ${failed} failed ───\n`);
  if (failed > 0) process.exit(1);
}

runAll().catch((err) => {
  console.error("  ❌ Test failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
