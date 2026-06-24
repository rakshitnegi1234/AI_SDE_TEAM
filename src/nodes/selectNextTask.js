


  // 1. selectNextTask picks the first pending task in Phase 1.
  // 2. contextBuilder extracts only the context needed for that task from blueprint, fileRegistry, sandbox files, etc.
  // 3. coderAgent writes the files for that task.
  // 4. updateRegistry records what those files export.
  // 5. snapshotManager marks that task as done.
  // 6. Graph loops back to selectNextTask.
  // 7. It picks the next pending task in the same phase.
  // 8. When all tasks in that phase are done, it naturally moves to the next phase.
  // 9. When all phases are done, it ends.


function findNextPendingTask(phase, taskStatuses) {
  const tasks = phase.tasks || [];

  return tasks.find((task) => {
    const status = taskStatuses[task.taskId];

    return !status || status === "pending";
    
  });
}

export function selectNextTaskRouter(state) {
  if (state.currentPhase === "done") {
    return "__end__";
  }

  if (state.currentTask) {
    return "contextBuilder";
  }

  return "__end__";
}



export function selectNextTaskNode(state) {

  console.log("\n[Select Next Task] Scanning task queue...\n");

  const phases = state.taskQueue?.phases || [];
  const taskStatuses = state.taskStatuses;

  if (phases.length === 0) {
    console.log("No phases found. Task queue is complete.");

    return {
      currentTask: null,
      currentPhase: "done",
    };
  }

  for (const phase of phases) {

    const nextTask = findNextPendingTask(phase, taskStatuses);

    if (nextTask) {

      return {
        currentTask: nextTask,
        currentPhaseIndex: phase.phaseNumber - 1,
        taskStatuses: {
          [nextTask.taskId]: "in_progress",
        },
        currentPhase: "dev_loop",
      };
    }
  }

  console.log("All tasks complete.");

  return {
    currentTask: null,
    currentPhase: "done",
  };
}
