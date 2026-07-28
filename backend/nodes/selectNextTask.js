export function selectNextTaskRouter(state) {
  return state.currentPhase === "done"
    ? "__end__"
    : state.currentTask
      ? "contextBuilder"
      : "__end__";
}

export function selectNextTaskNode(state) {
  console.log("\n[Select Next Task] Scanning task queue\n");

  const phases = Array.isArray(state.taskQueue?.phases)
    ? state.taskQueue.phases
    : [];

  if (phases.length === 0) {
    return done();
  }

  const taskStatuses = state.taskStatuses || {};
  const selected = findNextTask(phases, taskStatuses);

  if (!selected) {
    return done();
  }

  const { phase, phaseIndex, task, taskIndex } = selected;
  const currentTask = {
    ...task,
    phaseName: phase.phaseName,
    phaseNumber: phase.phaseNumber,
  };

  console.log(`Selected task ${currentTask.taskId} from ${currentTask.phaseName}`);

  return {
    currentTask,
    currentPhaseIndex: phaseIndex,
    currentTaskIndex: taskIndex,
    currentPhase: phase.phaseName,
    taskStatuses: taskStatuses[currentTask.taskId] === "in_progress"
      ? {}
      : { [currentTask.taskId]: "in_progress" },
  };
}

function findNextTask(phases, taskStatuses) {
  return findTask(phases, taskStatuses, "in_progress") ||
    findTask(phases, taskStatuses, "pending");
}

function findTask(phases, taskStatuses, wantedStatus) {
  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
    const phase = phases[phaseIndex];
    const tasks = Array.isArray(phase.tasks) ? phase.tasks : [];

    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      const task = tasks[taskIndex];
      const status = taskStatuses[task.taskId] || "pending";

      if (status === wantedStatus) {
        return { phase, phaseIndex, task, taskIndex };
      }
    }
  }

  return null;
}

function done() {
  console.log("All tasks complete.");

  return {
    currentTask: null,
    currentPhase: "done",
  };
}
