import { END, START, StateGraph } from "@langchain/langgraph";
import { pmAgentNode } from "../agents/pmAgent.js";
import {
  architectStep1Node,
  architectStep2Node,
  architectStep3Node,
  architectStep4Node,
  architectStep5Node,
} from "../agents/architectAgent.js";
import {
  blueprintValidatorNode,
  blueprintValidatorRouter,
} from "../agents/blueprintValidator.js";
import { coderAgentNode } from "../agents/coderAgent.js";
import {
  debuggerAgentNode,
  debuggerRouter,
} from "../agents/debuggerAgent.js";
import { executorAgentNode, executorRouter } from "../agents/executorAgent.js";
import { plannerAgentNode } from "../agents/plannerAgent.js";
import {
  plannerValidatorNode,
  plannerValidatorRouter,
} from "../agents/plannerValidator.js";
import { contextBuilderNode } from "../nodes/contextBuilder.js";
import { humanInputNode } from "../nodes/humanInput.js";
import { presentToUserNode } from "../nodes/presentToUser.js";
import {
  selectNextTaskNode,
  selectNextTaskRouter,
} from "../nodes/selectNextTask.js";
import { setupSandboxNode } from "../nodes/setupSandbox.js";
import { snapshotManagerNode } from "../nodes/snapshotManager.js";
import { updateRegistryNode } from "../nodes/updateRegistry.js";
import { createCheckpointer } from "./checkpointer.js";
import { AgentState } from "./state.js";

export async function buildPhase1Graph() {
  const graph = new StateGraph(AgentState);
  const checkpointer = await createCheckpointer();

  // 1. PM AGENT
  graph.addNode("pmAgent", pmAgentNode);
  graph.addNode("humanInput", humanInputNode);

  graph.addEdge(START, "pmAgent");
  graph.addEdge("humanInput", "pmAgent");

  graph.addConditionalEdges("pmAgent", (state) => {
    if (state.pmStatus === "needs_clarification") {
      return "humanInput";
    }

    if (state.pmStatus === "spec_ready") {
      return "architectStep1";
    }

    return END;
  });

  // 2. ARCHITECT AGENT
  graph.addNode("architectStep1", architectStep1Node);
  graph.addNode("architectStep2", architectStep2Node);
  graph.addNode("architectStep3", architectStep3Node);
  graph.addNode("architectStep4", architectStep4Node);
  graph.addNode("architectStep5", architectStep5Node);

  graph.addEdge("architectStep1", "architectStep2");
  graph.addEdge("architectStep2", "architectStep3");
  graph.addEdge("architectStep3", "architectStep4");
  graph.addEdge("architectStep4", "architectStep5");

  // 3. BLUEPRINT VALIDATOR
  graph.addNode("blueprintValidator", blueprintValidatorNode);
  graph.addEdge("architectStep5", "blueprintValidator");

  graph.addConditionalEdges("blueprintValidator", (state) => {
    const route = blueprintValidatorRouter(state);

    if (route === "__end__") {
      return "plannerAgent";
    }

    if (route === "__failed__") {
      return END;
    }

    return route;
  });

  // 4. PLANNER + SANDBOX
  graph.addNode("plannerAgent", plannerAgentNode);
  graph.addNode("plannerValidator", plannerValidatorNode);
  graph.addNode("setupSandbox", setupSandboxNode);

  graph.addConditionalEdges("plannerAgent", (state) => {
    return state.error ? END : "plannerValidator";
  });

  graph.addConditionalEdges("plannerValidator", plannerValidatorRouter, {
    setupSandbox: "setupSandbox",
    plannerAgent: "plannerAgent",
    __end__: END,
  });

  graph.addConditionalEdges("setupSandbox", (state) => {
    if (state.error || !state.sandboxHealthy) {
      return END;
    }

    return "selectNextTask";
  });

  // 5. CODING LOOP
  graph.addNode("selectNextTask", selectNextTaskNode);
  graph.addNode("contextBuilder", contextBuilderNode);
  graph.addNode("coderAgent", coderAgentNode);
  graph.addNode("updateRegistry", updateRegistryNode);
  graph.addNode("executorAgent", executorAgentNode);
  graph.addNode("debuggerAgent", debuggerAgentNode);
  graph.addNode("snapshotManager", snapshotManagerNode);

  // 5.1 TASK SELECTION
  graph.addConditionalEdges("selectNextTask", selectNextTaskRouter, {
    contextBuilder: "contextBuilder",
    __end__: "presentToUser",
  });

  // 5.2 CONTEXT BUILDER
  graph.addEdge("contextBuilder", "coderAgent");

  // 5.3 CODER AGENT
  graph.addEdge("coderAgent", "updateRegistry");

  // 5.4 UPDATE REGISTRY
  graph.addEdge("updateRegistry", "executorAgent");

  // 5.5 EXECUTOR AGENT
  graph.addConditionalEdges("executorAgent", executorRouter, {
    snapshotManager: "snapshotManager",
    debuggerAgent: "debuggerAgent",
  });

  // 5.6 DEBUGGER AGENT
  graph.addConditionalEdges("debuggerAgent", debuggerRouter, {
    contextBuilder: "contextBuilder",
  });

  // 5.7 SNAPSHOT MANAGER
  graph.addEdge("snapshotManager", "selectNextTask");

  // 6. PRESENTATION
  graph.addNode("presentToUser", presentToUserNode);

  graph.addEdge("presentToUser", END);

  // LangGraph saves a checkpoint after a graph step finishes successfully.
  return graph.compile({ checkpointer });
}

export const buildGraph = buildPhase1Graph;
