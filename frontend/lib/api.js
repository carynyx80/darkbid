// Darkbid API client.
export const API = process.env.NEXT_PUBLIC_API_URL || "";

async function request(path, options = {}) {
  let res;
  try {
    // Only send a JSON content type when there is a body, so plain reads skip the CORS preflight.
    res = await fetch(`${API}${path}`, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
    });
  } catch {
    throw new Error("Can’t reach Darkbid right now. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || "Something went wrong. Try again.");
    err.field = data.field;
    throw err;
  }
  return data;
}

export const logoSrc = (project) => `${API}${project.logoUrl}`;

export const listProjects = () => request("/projects").then((d) => d.projects);
export const listOwnProjects = (owner) => request(`/projects?owner=${encodeURIComponent(owner)}`).then((d) => d.projects);
export const getProject = (id) => request(`/projects/${encodeURIComponent(id)}`).then((d) => d.project);
export const registerProject = (body) => request("/projects", { method: "POST", body: JSON.stringify(body) });
export const submitAllowlistCode = (id, commitment) =>
  request(`/projects/${encodeURIComponent(id)}/allowlist`, { method: "POST", body: JSON.stringify({ commitment }) });
export const exportAllowlist = (id, message, signature) =>
  request(`/projects/${encodeURIComponent(id)}/allowlist/export`, { method: "POST", body: JSON.stringify({ message, signature }) }).then((d) => d.codes);

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
