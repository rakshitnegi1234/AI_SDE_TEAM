import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
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
import { debuggerAgentNode, debuggerRouter } from "../agents/debuggerAgent.js";
import { executorAgentNode, executorRouter } from "../agents/executorAgent.js";
import { plannerAgentNode } from "../agents/plannerAgent.js";
import { reviewerAgentNode, reviewerRouter } from "../agents/reviewerAgent.js";
import { contextBuilderNode } from "../nodes/contextBuilder.js";
import {
  deploymentVerifierNode,
  deploymentVerifierRouter,
} from "../nodes/deploymentVerifier.js";
import { humanEscalationNode, humanEscalationRouter } from "../nodes/humanEscalation.js";
import { humanInputNode } from "../nodes/humanInput.js";
import { presentToUserNode } from "../nodes/presentToUser.js";
import { sandboxHealthCheckNode } from "../nodes/sandboxHealthCheck.js";
import { selectNextTaskNode, selectNextTaskRouter } from "../nodes/selectNextTask.js";
import { setupSandboxNode } from "../nodes/setupSandbox.js";
import { simplifyTaskNode } from "../nodes/simplifyTask.js";
import { snapshotManagerNode } from "../nodes/snapshotManager.js";
import { updateRegistryNode } from "../nodes/updateRegistry.js";
import { AgentState } from "./state.js";


export function buildPhase1Graph(options = {}) 

{

  const graph = new StateGraph(AgentState);

  // LangGraph’s built-in in-memory checkpointer.
  const checkpointer = options.checkpointer || new MemorySaver();

  // PM AGENT 

  const pmNode = options.pmAgentNode || pmAgentNode;
  const inputNode = options.humanInputNode || humanInputNode;

  graph.addNode("pmAgent", pmNode);
  graph.addNode("humanInput", inputNode);

  graph.addEdge(START, "pmAgent");
  graph.addEdge("humanInput", "pmAgent");

  graph.addConditionalEdges("pmAgent", (state) => {
    if (state.pmStatus === "needs_clarification") 
    {
       return "humanInput";
    }
    if (state.pmStatus === "spec_ready") {
      return "architectStep1";
    }
    return END;
  });

  // ARCHITECT AGENT 

  const architectStep1 = options.architectStep1Node || architectStep1Node;
  const architectStep2 = options.architectStep2Node || architectStep2Node;
  const architectStep3 = options.architectStep3Node || architectStep3Node;
  const architectStep4 = options.architectStep4Node || architectStep4Node;
  const architectStep5 = options.architectStep5Node || architectStep5Node;

  graph.addNode("architectStep1", architectStep1);
  graph.addNode("architectStep2", architectStep2);
  graph.addNode("architectStep3", architectStep3);
  graph.addNode("architectStep4", architectStep4);
  graph.addNode("architectStep5", architectStep5);

  graph.addEdge("architectStep1", "architectStep2");
  graph.addEdge("architectStep2", "architectStep3");
  graph.addEdge("architectStep3", "architectStep4");
  graph.addEdge("architectStep4", "architectStep5");

  // BLUEPRINT VALIDATOR

  const validatorNode = options.blueprintValidatorNode || blueprintValidatorNode;
  const validatorRouter = options.blueprintValidatorRouter || blueprintValidatorRouter;

  graph.addEdge("architectStep5", "blueprintValidator");
  graph.addNode("blueprintValidator", validatorNode);

  graph.addConditionalEdges("blueprintValidator", (state) => {
    const route = validatorRouter(state);

    return route === "__end__" ? "plannerAgent" : route;
  });








  // PLANNER + SANDBOX

  const plannerNode = options.plannerAgentNode || plannerAgentNode;
  const setupNode = options.setupSandboxNode || setupSandboxNode;
  const healthNode = options.sandboxHealthCheckNode || sandboxHealthCheckNode;
  const selectTaskNode = options.selectNextTaskNode || selectNextTaskNode;
  const contextNode = options.contextBuilderNode || contextBuilderNode;
  const coderNode = options.coderAgentNode || coderAgentNode;
  const registryNode = options.updateRegistryNode || updateRegistryNode;
  const reviewerNode = options.reviewerAgentNode || reviewerAgentNode;
  const executorNode = options.executorAgentNode || executorAgentNode;
  const debuggerNode = options.debuggerAgentNode || debuggerAgentNode;
  const simplifyNode = options.simplifyTaskNode || simplifyTaskNode;
  const escalationNode = options.humanEscalationNode || humanEscalationNode;
  const snapshotNode = options.snapshotManagerNode || snapshotManagerNode;
  const deploymentNode = options.deploymentVerifierNode || deploymentVerifierNode;
  const presentationNode = options.presentToUserNode || presentToUserNode;

  graph.addNode("plannerAgent", plannerNode);
  graph.addNode("setupSandbox", setupNode);
  graph.addNode("sandboxHealthCheck", healthNode);
  graph.addNode("selectNextTask", selectTaskNode);
  graph.addNode("contextBuilder", contextNode);
  graph.addNode("coderAgent", coderNode);
  graph.addNode("updateRegistry", registryNode);
  graph.addNode("reviewerAgent", reviewerNode);
  graph.addNode("executorAgent", executorNode);
  graph.addNode("debuggerAgent", debuggerNode);
  graph.addNode("simplifyTask", simplifyNode);
  graph.addNode("humanEscalation", escalationNode);
  graph.addNode("snapshotManager", snapshotNode);
  graph.addNode("deploymentVerifier", deploymentNode);
  graph.addNode("presentToUser", presentationNode);

  graph.addConditionalEdges("plannerAgent", (state) => {
    return state.error ? END : "setupSandbox";
  });

  graph.addConditionalEdges("setupSandbox", (state) => {
    return state.error ? END : "sandboxHealthCheck";
  });

  graph.addConditionalEdges("sandboxHealthCheck", (state) => {
    if (state.error || !state.sandboxHealthy) return END;
    return "selectNextTask";
  });

  // CODING PHASE

  graph.addConditionalEdges("selectNextTask", selectNextTaskRouter, {
    contextBuilder: "contextBuilder",
    __end__: "deploymentVerifier",
  });


  graph.addEdge("contextBuilder", "coderAgent");
  graph.addEdge("coderAgent", "updateRegistry");
  graph.addEdge("updateRegistry", "reviewerAgent");
  graph.addConditionalEdges("reviewerAgent", reviewerRouter, {
    executorAgent: "executorAgent",
    simplifyTask: "simplifyTask",
    contextBuilder: "contextBuilder",
  });
  graph.addConditionalEdges("executorAgent", executorRouter, {
    snapshotManager: "snapshotManager",
    debuggerAgent: "debuggerAgent",
  });
  graph.addConditionalEdges("debuggerAgent", debuggerRouter, {
    humanEscalation: "humanEscalation",
    contextBuilder: "contextBuilder",
  });
  graph.addConditionalEdges("humanEscalation", humanEscalationRouter, {
    selectNextTask: "selectNextTask",
    simplifyTask: "simplifyTask",
    contextBuilder: "contextBuilder",
  });
  graph.addEdge("simplifyTask", "selectNextTask");
  graph.addEdge("snapshotManager", "selectNextTask");
  graph.addConditionalEdges("deploymentVerifier", deploymentVerifierRouter, {
    presentToUser: "presentToUser",
    debuggerAgent: "debuggerAgent",
  });
  graph.addEdge("presentToUser", END);








//  LangGraph saves a checkpoint after a graph step finishes successfully.
  return graph.compile({ checkpointer });

}

export const buildGraph = buildPhase1Graph;
