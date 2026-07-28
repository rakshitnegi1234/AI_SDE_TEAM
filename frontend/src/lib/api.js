/**
 * lib/api.js — REST API Client
 * 
 * Simple fetch wrapper for the Express server endpoints.
 * WebSocket handles real-time; this handles request-response.
 */

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

/** Start a new project */
export async function createProject(requirement) {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify({ requirement }),
  });
}

/** List active projects */
export async function listProjects() {
  return request("/projects");
}

/** Get project details + state */
export async function getProject(projectId) {
  return request(`/projects/${projectId}`);
}

/** Resume a checkpointed project */
export async function resumeProject(projectId) {
  return request(`/projects/${projectId}/resume`, { method: "POST" });
}

/** Submit human input when WebSocket is unavailable */
export async function sendHumanInput(projectId, data) {
  return request(`/projects/${projectId}/input`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

/** Cancel a running project */
export async function cancelProject(projectId) {
  return request(`/projects/${projectId}/cancel`, { method: "POST" });
}

/** Get sandbox info */
export async function getSandbox(projectId) {
  return request(`/projects/${projectId}/sandbox`);
}

/** Read a file from the sandbox */
export async function readFile(projectId, filePath) {
  return request(`/projects/${projectId}/files/${filePath}`);
}

/** Health check */
export async function healthCheck() {
  return request("/health");
}
