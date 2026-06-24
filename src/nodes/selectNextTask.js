export function selectNextTaskNode(state) {
  console.log("\n[Select Next Task] Scanning task queue...\n");

  const { taskQueue, taskStatuses = {} } = state;
  const phases = taskQueue?.phases || [];

  if (phases.length === 0) {
    console.log("   No phases in task queue");
    return { currentTask: null, currentPhase: "done" };
  }

  for (const phase of phases) {
    const tasks = phase.tasks || [];

    for (const task of tasks) {
      const status = taskStatuses[task.taskId];
      if (!status || status === "pending") {
        console.log(`   Next task: ${task.taskId} - ${task.title}`);
        console.log(`   Phase ${phase.phaseNumber}: ${phase.phaseName}`);
        if (task.filesToCreate?.length) {
          task.filesToCreate.forEach((filePath) => console.log(`   File: ${filePath}`));
        }

        return {
          currentTask: task,
          currentPhaseIndex: phase.phaseNumber - 1,
          taskStatuses: { [task.taskId]: "in_progress" },
          currentPhase: "dev_loop",
        };
      }
    }

    const allDone = tasks.every((task) => taskStatuses[task.taskId] === "done");
    if (allDone) {
      console.log(`   Phase ${phase.phaseNumber} (${phase.phaseName}) complete`);
    }
  }

  console.log("   All tasks complete");
  return {
    currentTask: null,
    currentPhase: "done",
  };
}

export function selectNextTaskRouter(state) {
  if (state.currentPhase === "done") return "__end__";
  if (state.currentTask) return "contextBuilder";
  return "__end__";
}
