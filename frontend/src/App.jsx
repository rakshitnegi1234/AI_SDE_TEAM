
import { useState, useCallback } from "react";
import useProjectStore from "./store/projectStore";
import useWebSocket from "./hooks/useWebSocket";
import { cancelProject, createProject, resumeProject, sendHumanInput } from "./lib/api";
import PipelineVisualizer from "./components/PipelineVisualizer";
import LogStream from "./components/LogStream";
import OutputPanel from "./components/OutputPanel";
import HumanInputPanel from "./components/HumanInputPanel";

const EXAMPLES = [
  {
    title: "Single-user todo app",
    description: "Add, complete, edit, and delete tasks. No auth.",
    requirement:
      "Build a simple single-user todo app with no authentication. The user can add tasks, mark tasks complete, edit task titles, delete tasks, and see an empty state when no tasks exist. Use PostgreSQL and provide one clean main page.",
  },
  {
    title: "Personal notes app",
    description: "Create, search, update, and delete notes. No auth.",
    requirement:
      "Build a simple single-user notes app with no authentication. The user can create notes with title and body, search notes, edit notes, delete notes, and view recent notes first. Use PostgreSQL and provide one clean main page.",
  },
  {
    title: "Expense tracker",
    description: "Add expenses, filter by category, and delete entries.",
    requirement:
      "Build a simple single-user expense tracker with no authentication. The user can add expenses with amount, category, date, and note, filter by category, view the total spend, and delete expenses. Use PostgreSQL and provide one clean main page.",
  },
];

export default function App() {
  const [requirementInput, setRequirementInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const projectId = useProjectStore((s) => s.projectId);
  const requirement = useProjectStore((s) => s.requirement);
  const status = useProjectStore((s) => s.status);
  const wsConnected = useProjectStore((s) => s.wsConnected);
  const humanInputRequest = useProjectStore((s) => s.humanInputRequest);
  const error = useProjectStore((s) => s.error);
  const errorRecoverable = useProjectStore((s) => s.errorRecoverable);
  const setProject = useProjectStore((s) => s.setProject);
  const reset = useProjectStore((s) => s.reset);

  const { sendMessage, disconnect } = useWebSocket(projectId);

  const handleStart = useCallback(async () => {
    if (!requirementInput.trim()) return;
    setIsStarting(true);
    try {
      const result = await createProject(requirementInput.trim());
      setProject(result.projectId, requirementInput.trim());
      setRequirementInput("");
    } catch (e) {
      alert(`Failed to start project: ${e.message}`);
    } finally {
      setIsStarting(false);
    }
  }, [requirementInput, setProject]);

  const handleHumanResponse = useCallback(
    async (data) => {
      const sent = sendMessage({ type: "human_response", data });

      try {
        if (!sent && projectId) {
          await sendHumanInput(projectId, data);
        }

        useProjectStore.setState({ status: "running", humanInputRequest: null });
      } catch (e) {
        useProjectStore.setState({
          status: "waiting_input",
          error: `Input submit failed: ${e.message}`,
        });
      }
    },
    [projectId, sendMessage]
  );

  const handleCancel = useCallback(async () => {
    const sent = sendMessage({ type: "cancel" });

    try {
      if (!sent && projectId) {
        await cancelProject(projectId);
      }

      useProjectStore.setState({ status: "cancelled", activeNode: null });
    } catch (e) {
      useProjectStore.setState({
        status: "error",
        error: `Cancel failed: ${e.message}`,
      });
    }
  }, [projectId, sendMessage]);

  const handleResume = useCallback(async () => {
    if (!projectId) return;
    try {
      useProjectStore.setState({ status: "running", error: null, errorRecoverable: false });
      await resumeProject(projectId);
    } catch (e) {
      useProjectStore.setState({ status: "error", error: `Resume failed: ${e.message}` });
    }
  }, [projectId]);

  const handleNewProject = useCallback(() => {
    disconnect();
    reset();
  }, [disconnect, reset]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-mark">//</span>
            <span className="logo-text">DEVTEAM</span>
          </div>
          <span className="header-divider" />
          <span className="header-label">mission control</span>
        </div>
        <div className="header-right">
          <div className="conn-indicator">
            <span className={`conn-dot ${wsConnected ? "live" : ""}`} />
            <span className="conn-label">{wsConnected ? "CONNECTED" : "OFFLINE"}</span>
          </div>
          {projectId && (
            <button className="btn btn-text" onClick={handleNewProject}>
              NEW PROJECT
            </button>
          )}
        </div>
      </header>

      <div className="model-caution" role="status">
        <span className="model-caution-label">ADVICE</span>
        <span className="model-caution-text">
          Use one project at a time. Free model quota can delay or fail generation.
        </span>
      </div>

      <main className="main">
        {!projectId ? (
          <div className="landing">
            <div className="landing-inner">
              <div className="landing-left">
                <p className="landing-pre">MULTI-AGENT AI SYSTEM</p>
                <h1 className="landing-title">
                  Describe the app.
                  <span>Get the live URL.</span>
                </h1>
                <p className="landing-desc">
                  Enter one clear requirement. The pipeline plans, writes,
                  checks, fixes, and launches the app with the backend running
                  behind the frontend.
                </p>
                <div className="landing-steps" aria-label="pipeline steps">
                  <span>Plan</span>
                  <span>Build</span>
                  <span>Check</span>
                  <span>Launch</span>
                </div>
              </div>
              <div className="landing-right">
                <div className="input-block">
                  <label className="input-label">PROJECT REQUIREMENT</label>
                  <textarea
                    value={requirementInput}
                    onChange={(e) => setRequirementInput(e.target.value)}
                    placeholder="Build a simple single-user todo app with no authentication. The user can add, complete, edit, and delete tasks..."
                    rows={5}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleStart();
                    }}
                  />
                  <div className="input-actions">
                    <button
                      className="btn btn-accent"
                      onClick={handleStart}
                      disabled={!requirementInput.trim() || isStarting}
                    >
                      {isStarting ? "INITIALIZING..." : "LAUNCH"}
                    </button>
                    <span className="input-shortcut">Ctrl+Enter</span>
                  </div>
                </div>
                <div className="templates">
                  <span className="templates-label">TEMPLATES</span>
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.title}
                      className="template-btn"
                      onClick={() => setRequirementInput(ex.requirement)}
                    >
                      <span className="template-title">{ex.title}</span>
                      <span className="template-desc">{ex.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="dashboard">
            <div className="req-bar">
              <div className="req-bar-left">
                <span className="req-label">TARGET</span>
                <span className="req-text">{requirement}</span>
              </div>
              <div className="req-bar-right">
                <span className={`status-pill status--${status}`}>
                  {status === "running" && "RUNNING"}
                  {status === "waiting_input" && "AWAITING INPUT"}
                  {status === "complete" && "COMPLETE"}
                  {status === "error" && "ERROR"}
                  {status === "cancelled" && "CANCELLED"}
                  {status === "idle" && "IDLE"}
                </span>
                {status === "running" && (
                  <button className="btn btn-text btn-sm" onClick={handleCancel}>
                    ABORT
                  </button>
                )}
                {status === "error" && errorRecoverable && (
                  <button className="btn btn-accent btn-sm" onClick={handleResume}>
                    RETRY
                  </button>
                )}
              </div>
            </div>

            {status === "error" && error && (
              <div className="error-bar">
                <span className="error-bar-label">ERROR</span>
                <span className="error-bar-msg">{error}</span>
                {errorRecoverable && (
                  <span className="error-bar-hint">Checkpointed. Click RETRY to resume from last good state.</span>
                )}
              </div>
            )}

            <PipelineVisualizer />

            <div className="dashboard-grid">
              <div className="dashboard-col">
                <LogStream />
              </div>
              <div className="dashboard-col">
                <OutputPanel />
              </div>
            </div>

            {humanInputRequest && (
              <HumanInputPanel
                request={humanInputRequest}
                onSubmit={handleHumanResponse}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
