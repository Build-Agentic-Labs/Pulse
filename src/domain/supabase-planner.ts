// Compatibility facade for the planner's Supabase persistence. Every existing importer (and every test
// that mocks "@/domain/supabase-planner") keeps using this path; the implementations live in
// src/lib/planner/ (client, query-helpers, row-mappers, realtime, media-rows, media-storage,
// media-store, tool-store, access-store, workspace-store, read-store, scenario-store, shell-store,
// bom-store, task-store). Re-exports only: no logic, no module state. Leaves never import this file.

export { createPlannerSupabaseClient, getUserFromSession } from "@/lib/planner/client";
export { mapScenarioSummary, procedureTaskUpdateRow } from "@/lib/planner/row-mappers";
export {
  taskIdFromRealtimePayload,
  canPatchTaskFromRealtimePayload,
  isRealtimePayloadInScope,
  subscribePlannerStateChanges,
} from "@/lib/planner/realtime";
export type { PlannerRealtimePayload } from "@/lib/planner/realtime";
export { refreshSignedMediaUrl } from "@/lib/planner/media-storage";
export {
  softDeleteStepPhotoAttachmentFromSupabase,
  softDeleteExplodedViewFromSupabase,
  removeExplodedViewObject,
  updateStepPhotoCaptionInSupabase,
  uploadStepPhotoAttachment,
  removeStepPhotoAttachmentObject,
  copyStepPhotoAttachmentToStep,
  saveExplodedViewToSupabase,
  saveTaskVideoToSupabase,
  softDeleteTaskVideoFromSupabase,
  removeTaskVideoObject,
} from "@/lib/planner/media-store";
export type { ExplodedViewUploadInput, TaskVideoUploadInput } from "@/lib/planner/media-store";
export {
  addStepToolToSupabase,
  removeStepToolFromSupabase,
  syncStepToolsForStepToSupabase,
  loadToolLibraryFromSupabase,
  uploadToolLibraryImage,
  upsertToolLibraryMetadata,
  deleteToolLibraryFromSupabase,
} from "@/lib/planner/tool-store";
export type { ToolLibraryItem } from "@/lib/planner/tool-store";
export {
  fetchIsSuperAdmin,
  fetchOrgToolAccess,
  fetchProductAccess,
  setProductAccessInSupabase,
  loadAuditLogFromSupabase,
  setProjectAccessInSupabase,
  setOrgToolAccessInSupabase,
} from "@/lib/planner/access-store";
export type { AuditLogEntry } from "@/lib/planner/access-store";
export {
  ensureDefaultWorkspaceMembership,
  loadWorkspaceProjectGroups,
  createProjectWithStarterPlan,
  updateWorkspaceInSupabase,
  loadProfileNamesByIds,
  updateProjectInSupabase,
  deleteProjectFromSupabase,
  loadWorkspaceMembersFromSupabase,
  loadWorkspaceAccessGrantsFromSupabase,
  upsertWorkspaceAccessGrantInSupabase,
  removeWorkspaceMemberInSupabase,
  updateWorkspaceMemberRoleInSupabase,
  updateOwnProfileNameInSupabase,
  deleteWorkspaceAccessGrantFromSupabase,
  loadMembersAccessForWorkspace,
} from "@/lib/planner/workspace-store";
export {
  loadPlannerStateWithProjectFromSupabase,
  buildPlannerSummaryState,
  loadPlannerSummaryStateFromSupabase,
  loadPlannerStateFromSupabase,
  loadPlannerCoreStateFromSupabase,
  loadProjectTaskTargetsFromSupabase,
  loadTaskPrivateMediaFromSupabase,
  loadTaskFromSupabase,
} from "@/lib/planner/read-store";
export type { ProjectTaskTarget } from "@/lib/planner/read-store";
export {
  loadScenariosForProduct,
  listSopSummariesFromSupabase,
  duplicateScenario,
  updateScenarioTarget,
  renameScenario,
  deleteScenario,
} from "@/lib/planner/scenario-store";
export type { SopSummary } from "@/lib/planner/scenario-store";
export {
  upsertWouldCollideOnSequence,
  assertSaneStateDeletion,
  savePlannerStateToSupabase,
  savePlannerShellToSupabase,
} from "@/lib/planner/shell-store";
export type { SaveState } from "@/lib/planner/shell-store";
export { saveMasterBomToSupabase } from "@/lib/planner/bom-store";
export {
  saveTasksToSupabase,
  saveTaskRowToSupabase,
  saveTaskToSupabase,
  saveTaskPhotoAnnotationsToSupabase,
  saveTaskCustomFieldsToSupabase,
  saveTaskWithManufacturingStepsToSupabase,
  saveTaskAndManufacturingStepToSupabase,
  saveMobileStepToSupabase,
  saveManufacturingStepToSupabase,
  updateTaskFields,
  upsertProcedureStep,
  reorderProcedureSteps,
  deletePlannerTask,
  saveProcedureTaskUpdateToSupabase,
  moveManufacturingStepToTaskInSupabase,
  mergeLatestTaskToSupabase,
} from "@/lib/planner/task-store";
