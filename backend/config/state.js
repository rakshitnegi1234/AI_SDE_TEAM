

import { Annotation } from "@langchain/langgraph";

// annotation.root gives schema of graph state

export const AgentState = Annotation.Root({
  
  // USER INPUT 

  userRequirement: Annotation({
    
    reducer: (prevreq, newreq) => newreq ?? prevreq,
    default: () => "",
  }),

  // PM AGENT 

  pmStatus: Annotation({

      reducer: (prevstatus, newstatus) =>
      newstatus ?? prevstatus,
      default: () => "idle",
  }),
  
  pmQuestions: Annotation({
    reducer: (prevques, newques) => newques ?? prevques,

    default: () => [],
  }),


  pmConversation: Annotation(
  {
    reducer:(prevconversation, newconversation) =>  
      {

      if (!newconversation) return prevconversation;

      if (Array.isArray(newconversation))
      {
        return [...prevconversation, ...newconversation];
      }

      return prevconversation;
    },

    default: () => [],

  }),

  clarifiedSpec: Annotation({
      reducer: (prevspec, newspec) =>
      newspec ?? prevspec,
      default: () => null,
  }),



  // ARCHITECT AGENT ( Built In 5 Steps )

  blueprint: Annotation({

    reducer: (prevBlueprint, newBlueprint) => {

      if (!prevBlueprint) return newBlueprint;

      return {
        ...prevBlueprint,
        ...newBlueprint,
      };
    },

    default: () => ({
      entities: [],
      dbSchema: {},
      apiEndpoints: [],
      frontendPages: [],
      sharedComponents: [],
      routingNotes: [],
      folderStructure: "",
      dependencies: {},
    }),
  }),


  //  BLUEPRINT VALIDATOR 

  blueprintValidation: Annotation({

    reducer: (prevValidation, newValidation) =>
      newValidation ?? prevValidation,

    default: () => ({
      isValid: false,
      issues: [],
      validationCycles: 0,
    }),
  }),




  //  PLANNER AGENT -- - > CODER AGENT


  taskQueue: Annotation({
      reducer: (prevtaskQueue, newtaskQueue) =>
      newtaskQueue ?? prevtaskQueue,
      default: () => ({ phases: [] }),
  }),

  currentPhaseIndex: Annotation({
     reducer: (prevPhase, newPhase) =>
      newPhase ?? prevPhase,
     default: () => 0,
  }),

  currentTaskIndex: Annotation({
     reducer: (prevTask, newTask) =>
      newTask ?? prevTask,
     default: () => 0,
  }),


    plannerValidation: Annotation({
    reducer: (previousValidation, incomingValidation) =>
      incomingValidation ?? previousValidation,
    default: () => ({
      isValid: false,
      issues: [],
      validationCycles: 0,
    }),
  }),



   // Track status of each task:
  // { "setup-1": "done", "setup-2": "in_progress", ... }
  
   taskStatuses: Annotation({
    reducer: (existStatus, newStatus) => {
      if (!newStatus) return existStatus;

      return {
        ...existStatus,
        ...newStatus,
      };
    },
    
    default: () => ({}),
  }),


  currentTask: Annotation({
    reducer: (previousTask, incomingTask) =>
      incomingTask === undefined ? previousTask : incomingTask,
    default: () => null,
  }),



    // SANDBOX 
  sandboxId: Annotation({
    reducer: (prevSandId, newSandId) =>
      newSandId ?? prevSandId,
    default: () => "",
  }),

  sandboxHealthy: Annotation({
    reducer: (prevhealthStatus, newhealthStatus) =>
      newhealthStatus ?? prevhealthStatus,
    default: () => false,
  }),


 
 
currentPhase: Annotation({
    reducer: (previousPhase, incomingPhase) =>
      incomingPhase ?? previousPhase,
    default: () => "phase1",
  }),


  contextPackage: Annotation({
    reducer: (prevContextPackage, newContextPackage) =>
      newContextPackage === undefined ? prevContextPackage : newContextPackage,
    default: () => null,
  }),

  // Latest coder output
  coderOutput: Annotation({
    reducer: (prevCoderOutput, newCoderOutput) =>
      prevCoderOutput === undefined ? prevCoderOutput : newCoderOutput,
    default: () => null,
  }),


  //  FILE INTERFACE REGISTRY 
  
  fileRegistry: Annotation({
    reducer: (existingFiles, incomingFiles) => {
      if (!incomingFiles) return existingFiles;

      if (Array.isArray(incomingFiles)) {
          const fileMap = new Map(
          existingFiles.map((file) => [file.path, file])
        );

        for (const incomingFile of incomingFiles) {
          fileMap.set(incomingFile.path, incomingFile);
        }

        return Array.from(fileMap.values());
      }

      return existingFiles;
    },
    default: () => [],
  }),

  

  //  REVIEWER 
  reviewResult: Annotation({
    reducer: (prevReviewResult, newReviewResult) =>
      newReviewResult ?? {
       prevReviewResult
      },
    default: () => ({
      verdict: "",
      issues: [],
      reviewCycle: 0,
    }),
  }),


  //  EXECUTOR 
  executionResult: Annotation({
    reducer: (prevExecutionResult, newExecutionResult) =>
      newExecutionResult ?? {
      prevExecutionResult,
      },
    default: () => ({
      result: "",
      output: "",
      errors: "",
    }),
  }),



  //  DEBUGGER 
  debugState: Annotation({
    reducer: (prevDebugState, newDebugState) =>
      newDebugState ?? {
            prevDebugState
      },
    default: () => ({
      tier: 1,
      attempts: 0,
      maxAttempts: 3,
      rollbackAttempted: false,
      rollbackContext: null,
    }),
  }),

  error: Annotation({
    reducer: (preverror, newerror) =>
      newerror ?? preverror,
      default: () => null,
  }),
});
