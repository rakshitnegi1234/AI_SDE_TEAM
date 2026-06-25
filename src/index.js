import * as readline from "readline";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { buildPhase1Graph } from "./config/graph.js";
import { initGemini } from "./utils/gemini.js";

export { buildGraph, buildPhase1Graph } from "./config/graph.js";
export { AgentState } from "./config/state.js";
export { coderAgentNode } from "./agents/coderAgent.js";
export { contextBuilderNode } from "./nodes/contextBuilder.js";
export { debuggerAgentNode, debuggerRouter } from "./agents/debuggerAgent.js";
export {
  deploymentVerifierNode,
  deploymentVerifierRouter,
} from "./nodes/deploymentVerifier.js";
export { executorAgentNode, executorRouter } from "./agents/executorAgent.js";
export {
  plannerValidatorNode,
  plannerValidatorRouter,
} from "./agents/plannerValidator.js";
export { reviewerAgentNode, reviewerRouter } from "./agents/reviewerAgent.js";
export { presentToUserNode } from "./nodes/presentToUser.js";
export { selectNextTaskNode, selectNextTaskRouter } from "./nodes/selectNextTask.js";
export { simplifyTaskNode } from "./nodes/simplifyTask.js";
export { snapshotManagerNode } from "./nodes/snapshotManager.js";
export { updateRegistryNode } from "./nodes/updateRegistry.js";
dotenv.config({ path: new URL("../.env", import.meta.url) });

async function getRequirement() {
  return askUser("Requirement: ");
}

function askUser(question) {

  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

    return new Promise((resolve) => {

    terminal.question(question, (answer) => {
      terminal.close();
      resolve(answer.trim());
    });
  });
}


async function main() {
  initGemini(process.env.GEMINI_API_KEY);

  const requirement = await getRequirement();

  if (!requirement) {
    console.log("No requirement provided.");
    process.exit(0);
  }

  const graph = await buildPhase1Graph();

  //  await graph.invoke(inputState, config)

  const finalState = await graph.invoke(

    {
      userRequirement: requirement,
    },

   {
      configurable: {
        thread_id: `phase1-${Date.now()}`,
      },

      recursionLimit: Number.parseInt(process.env.GRAPH_RECURSION_LIMIT || "500", 10),
    }
  );


  if (finalState.error) {
    console.error(finalState.error);
    process.exit(1);
  }

  if (finalState.clarifiedSpec) {
    console.log("\nFINAL SPEC:\n");
    console.log(JSON.stringify(finalState.clarifiedSpec, null, 2));
  }

  if (finalState.taskQueue?.phases?.length) {
    console.log("\nTASK PLAN:\n");
    console.log(JSON.stringify(finalState.taskQueue, null, 2));
  }

  if (finalState.sandboxId) {
    console.log("\nSANDBOX:\n");
    console.log(JSON.stringify({
      sandboxId: finalState.sandboxId,
      healthy: finalState.sandboxHealthy,
    }, null, 2));
  }

  if (finalState.clarifiedSpec || finalState.taskQueue?.phases?.length || finalState.sandboxId) {
    return;
  }

  console.error("Graph completed without producing a clarified spec.");
  process.exit(1);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
