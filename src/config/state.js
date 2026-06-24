

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
      return [...prevconversation,newconversation];
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





  // ─── BLUEPRINT VALIDATOR ──────────────────────────────────
  blueprintValidation: Annotation({
    reducer: (previousValidation, incomingValidation) =>
      incomingValidation ?? {
        isValid: false,
        issues: [],
        validationCycles: 0,
      },
    default: () => ({
      isValid: false,
      issues: [],
      validationCycles: 0,
    }),
  }),
















  
  // ─── PLANNER AGENT ────────────────────────────────────────
  taskQueue: Annotation({
    reducer: (previousTaskQueue, incomingTaskQueue) =>
      incomingTaskQueue ?? { phases: [] },
    default: () => ({ phases: [] }),
  }),

  currentPhaseIndex: Annotation({
    reducer: (previousPhaseIndex, incomingPhaseIndex) =>
      incomingPhaseIndex ?? 0,
    default: () => 0,
  }),

  currentTaskIndex: Annotation({
    reducer: (previousTaskIndex, incomingTaskIndex) =>
      incomingTaskIndex ?? 0,
    default: () => 0,
  }),

  // ─── FILE INTERFACE REGISTRY ──────────────────────────────
  // Grows after every task — needs accumulating reducer
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

  // ─── PROJECT PATTERNS (V2 NEW) ───────────────────────────
  projectPatterns: Annotation({
    reducer: (existingPatterns, incomingPatterns) => {
      if (!incomingPatterns) return existingPatterns;

      return {
        ...existingPatterns,
        ...incomingPatterns,
      };
    },
    default: () => ({
      errorHandling: "",
      namingConvention: "",
      responseFormat: "",
      importStyle: "",
      stateManagement: "",
      commentStyle: "",
    }),
  }),

  // ─── SANDBOX ──────────────────────────────────────────────
  sandboxId: Annotation({
    reducer: (previousSandboxId, incomingSandboxId) =>
      incomingSandboxId ?? "",
    default: () => "",
  }),

  sandboxHealthy: Annotation({
    reducer: (previousHealthStatus, incomingHealthStatus) =>
      incomingHealthStatus ?? false,
    default: () => false,
  }),

  // ─── DEV LOOP (Phase 4) ──────────────────────────────────
  currentTask: Annotation({
    reducer: (previousTask, incomingTask) =>
      incomingTask ?? null,
    default: () => null,
  }),

  // Track status of each task:
  // { "setup-1": "done", "setup-2": "in_progress", ... }
  taskStatuses: Annotation({
    reducer: (existingStatuses, incomingStatuses) => {
      if (!incomingStatuses) return existingStatuses;

      return {
        ...existingStatuses,
        ...incomingStatuses,
      };
    },
    default: () => ({}),
  }),

  // Context package built for the coder
  contextPackage: Annotation({
    reducer: (previousContextPackage, incomingContextPackage) =>
      incomingContextPackage ?? null,
    default: () => null,
  }),

  // Latest coder output
  coderOutput: Annotation({
    reducer: (previousCoderOutput, incomingCoderOutput) =>
      incomingCoderOutput ?? null,
    default: () => null,
  }),

  // ─── REVIEWER ─────────────────────────────────────────────
  reviewResult: Annotation({
    reducer: (previousReviewResult, incomingReviewResult) =>
      incomingReviewResult ?? {
        verdict: "",
        issues: [],
        reviewCycle: 0,
      },
    default: () => ({
      verdict: "",
      issues: [],
      reviewCycle: 0,
    }),
  }),

  // ─── EXECUTOR ─────────────────────────────────────────────
  executionResult: Annotation({
    reducer: (previousExecutionResult, incomingExecutionResult) =>
      incomingExecutionResult ?? {
        result: "",
        output: "",
        errors: "",
      },
    default: () => ({
      result: "",
      output: "",
      errors: "",
    }),
  }),

  // ─── DEBUGGER ─────────────────────────────────────────────
  debugState: Annotation({
    reducer: (previousDebugState, incomingDebugState) =>
      incomingDebugState ?? {
        tier: 1,
        attempts: 0,
        maxAttempts: 3,
        rollbackAttempted: false,
      },
    default: () => ({
      tier: 1,
      attempts: 0,
      maxAttempts: 3,
      rollbackAttempted: false,
    }),
  }),

  // ─── USER FEEDBACK ────────────────────────────────────────
  userFeedback: Annotation({
    reducer: (existingFeedback, incomingFeedback) => {
      if (!incomingFeedback) return existingFeedback;

      if (Array.isArray(incomingFeedback)) {
        return [...existingFeedback, ...incomingFeedback];
      }

      return [...existingFeedback, incomingFeedback];
    },
    default: () => [],
  }),

  feedbackIteration: Annotation({
    reducer: (previousIteration, incomingIteration) =>
      incomingIteration ?? 0,
    default: () => 0,
  }),

  maxFeedbackIterations: Annotation({
    reducer: (previousMaxIterations, incomingMaxIterations) =>
      incomingMaxIterations ?? 3,
    default: () => 3,
  }),

  scopeDrift: Annotation({
    reducer: (previousScopeDrift, incomingScopeDrift) =>
      incomingScopeDrift ?? 0.0,
    default: () => 0.0,
  }),

  userSatisfied: Annotation({
    reducer: (previousUserSatisfied, incomingUserSatisfied) =>
      incomingUserSatisfied ?? false,
    default: () => false,
  }),

  // ─── DEPLOYMENT ───────────────────────────────────────────
  deploymentConfig: Annotation({
    reducer: (previousDeploymentConfig, incomingDeploymentConfig) =>
      incomingDeploymentConfig ?? {
        platform: "",
        files: [],
        instructions: [],
      },
    default: () => ({
      platform: "",
      files: [],
      instructions: [],
    }),
  }),

  deploymentAttempts: Annotation({
    reducer: (previousDeploymentAttempts, incomingDeploymentAttempts) =>
      incomingDeploymentAttempts ?? 0,
    default: () => 0,
  }),

  // // ─── TOKEN TRACKING (V2 NEW) ──────────────────────────────
  // tokenUsage: Annotation({
  //   reducer: (existingUsage, incomingUsage) => {
  //     if (!incomingUsage) return existingUsage;

  //     return {
  //       calls: [
  //         ...(existingUsage.calls || []),
  //         ...(incomingUsage.newCalls || []),
  //       ],
  //       totalInput:
  //         existingUsage.totalInput + (incomingUsage.addedInput || 0),
  //       totalOutput:
  //         existingUsage.totalOutput + (incomingUsage.addedOutput || 0),
  //       estimatedCost:
  //         existingUsage.estimatedCost + (incomingUsage.addedCost || 0),
  //     };
  //   },
  //   default: () => ({
  //     calls: [],
  //     totalInput: 0,
  //     totalOutput: 0,
  //     estimatedCost: 0.0,
  //   }),
  // }),

  // tokenBudget: Annotation({
  //   reducer: (previousTokenBudget, incomingTokenBudget) =>
  //     incomingTokenBudget ?? 2.0,
  //   default: () => 2.0,
  // }),







  currentPhase: Annotation(
  {
      reducer: (prevphase, newphase) =>
      newphase ?? prevphase,

      default: () => "pm", 
  }),


  error: Annotation({
    reducer: (preverror, newerror) =>
      newerror ?? preverror,
      default: () => null,
  }),
});
