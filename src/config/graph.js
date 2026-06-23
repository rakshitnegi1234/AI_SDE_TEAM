import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { pmAgentNode } from "../agents/pmAgent.js";
import { humanInputNode } from "../nodes/humanInput.js";
import { AgentState } from "./state.js";


export function buildPhase1Graph(options = {}) {

  const graph = new StateGraph(AgentState);

   // LangGraph’s built-in in-memory checkpointer.
  const checkpointer =  new MemorySaver();


  graph.addNode("pmAgent", pmAgentNode);
  graph.addNode("humanInput", humanInputNode);


  graph.addEdge(START, "pmAgent");
  graph.addEdge("humanInput", "pmAgent");

  graph.addConditionalEdges("pmAgent", (state) => {
    if (state.pmStatus === "needs_clarification") 
    {
       return "humanInput";
    }
    return END;

  });

  return graph.compile({ checkpointer });

}
