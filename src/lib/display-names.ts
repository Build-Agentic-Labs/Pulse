const LEGACY_WORKSPACE_NAMES = new Set(["buildlogic workspace", "pulse workspace"]);

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

export function displayWorkspaceName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "Pulse";
  if (LEGACY_WORKSPACE_NAMES.has(normalizeKey(trimmed))) return "Pulse";
  return trimmed;
}

export function shouldShowProductName(productName: string, projectName?: string) {
  const product = productName.trim();
  const project = projectName?.trim() ?? "";
  if (!product) return false;
  if (!project) return true;
  return normalizeKey(product) !== normalizeKey(project);
}

export function shouldShowWorkspaceName(
  workspaceName: string,
  projectName?: string,
  options?: { hideDefaultOrg?: boolean },
) {
  const workspace = displayWorkspaceName(workspaceName);
  const project = projectName?.trim() ?? "";
  if (!workspace) return false;
  if (options?.hideDefaultOrg && workspace === "Pulse") return false;
  if (project && normalizeKey(workspace) === normalizeKey(project)) return false;
  return true;
}

export function projectContextLabel(projectName: string, workspaceName: string) {
  const workspace = displayWorkspaceName(workspaceName);
  if (workspace === "Pulse") return projectName;
  if (normalizeKey(projectName) === normalizeKey(workspace)) return projectName;
  return `${workspace} · ${projectName}`;
}
