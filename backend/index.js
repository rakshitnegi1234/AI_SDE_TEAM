import * as readline from "readline/promises";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import { buildPhase1Graph } from "./config/graph.js";
import { initGemini } from "./utils/gemini.js";

export { buildGraph, buildPhase1Graph } from "./config/graph.js";
export { AgentState } from "./config/state.js";
export { coderAgentNode } from "./agents/coderAgent.js";
export { contextBuilderNode } from "./nodes/contextBuilder.js";
export { debuggerAgentNode, debuggerRouter } from "./agents/debuggerAgent.js";
export { executorAgentNode, executorRouter } from "./agents/executorAgent.js";
export { repairJsonAgentNode } from "./agents/jsonRepairAgent.js";
export {
  plannerValidatorNode,
  plannerValidatorRouter,
} from "./agents/plannerValidator.js";
export { presentToUserNode } from "./nodes/presentToUser.js";
export { selectNextTaskNode, selectNextTaskRouter } from "./nodes/selectNextTask.js";
export { snapshotManagerNode } from "./nodes/snapshotManager.js";
export { updateRegistryNode } from "./nodes/updateRegistry.js";
dotenv.config({ path: new URL("../.env", import.meta.url) });

async function getRequirement() {
  return askUser("Requirement: ");
}

async function askUser(question) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await terminal.question(question);
  terminal.close();
  return answer.trim();
}


async function main() {
  
  initGemini(process.env.GEMINI_API_KEY);

  const requirement = await getRequirement();

  if (!requirement) {
    console.log("No requirement BRO.");
     return;
  }

  const graph = await buildPhase1Graph();

  //  await graph.invoke(inputState, config)

  const finalState = await graph.invoke(

    {
      userRequirement: requirement,
    },

   {
      configurable: {
        thread_id: `phase1-${randomUUID()}`,
      },

      recursionLimit: Number.parseInt("100", 10),
    }
  );



  
  if (finalState.error) {
    console.error(finalState.error);
    return;
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
  return;
}

main().catch((error) => {
  console.error(error.message);
});
