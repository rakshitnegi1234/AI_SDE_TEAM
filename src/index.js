import * as readline from "readline";
import dotenv from "dotenv";
import { buildPhase1Graph } from "./config/graph.js";
import { initGemini } from "./utils/gemini.js";
dotenv.config({ path: new URL("../.env", import.meta.url) });
initGemini(process.env.GEMINI_API_KEY);

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

  const requirement = await getRequirement();

  if (!requirement) {
    console.log("No requirement provided.");
    process.exit(0);
  }

  const graph = buildPhase1Graph();

  //  await graph.invoke(inputState, config)

  const finalState = await graph.invoke(

    {
      userRequirement: requirement,
    },

   {
      configurable: {
        thread_id: `phase1-${Date.now()}`,
      },

      recursionLimit: 20,
    }
  );


  if (finalState.clarifiedSpec) {
    console.log("\nFINAL SPEC:\n");
    console.log(JSON.stringify(finalState.clarifiedSpec, null, 2));
    return;
  }

  if (finalState.error) {
    console.error(finalState.error);
    process.exit(1);
  }

  console.error("Graph completed without producing a clarified spec.");
  process.exit(1);
}

// Start program and catch unexpected errors

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});