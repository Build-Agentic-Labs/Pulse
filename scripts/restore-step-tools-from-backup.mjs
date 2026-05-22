import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

function loadEnvValue(envText, key) {
  const line = envText
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith(`${key}=`));

  if (!line) {
    return undefined;
  }

  return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
}

async function main() {
  const cwd = process.cwd();
  const envText = await readFile(path.join(cwd, ".env.local"), "utf8");
  const supabaseUrl = loadEnvValue(envText, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? loadEnvValue(envText, "SUPABASE_SERVICE_ROLE_KEY");
  const cliArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
  const backupDir =
    cliArgs[0] || path.join(cwd, "backups", "flexboost-2026-05-20T20-33-26-921Z");
  const targetProjectId = process.env.PROJECT_ID || "project-flexboost";
  const apply = process.argv.includes("--apply");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in the environment or .env.local before restoring.");
  }

  const backupTools = JSON.parse(await readFile(path.join(backupDir, "raw", "step_tools.json"), "utf8"));
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: projects, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", targetProjectId);

  if (projectError) {
    throw new Error(`Unable to load project ${targetProjectId}: ${projectError.message}`);
  }

  if (!projects?.length) {
    throw new Error(`Project ${targetProjectId} was not found.`);
  }

  const { data: products, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("project_id", targetProjectId);

  if (productError) {
    throw new Error(`Unable to load products: ${productError.message}`);
  }

  const productIds = (products ?? []).map((product) => product.id);
  const { data: scenarios, error: scenarioError } = await supabase
    .from("scenarios")
    .select("id")
    .in("product_id", productIds.length ? productIds : ["__missing__"]);

  if (scenarioError) {
    throw new Error(`Unable to load scenarios: ${scenarioError.message}`);
  }

  const scenarioIds = (scenarios ?? []).map((scenario) => scenario.id);
  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id")
    .in("scenario_id", scenarioIds.length ? scenarioIds : ["__missing__"]);

  if (taskError) {
    throw new Error(`Unable to load tasks: ${taskError.message}`);
  }

  const liveTaskIds = new Set((tasks ?? []).map((task) => task.id));
  const scopedBackupTools = backupTools.filter((tool) => liveTaskIds.has(tool.task_id));

  const { data: liveSteps, error: stepError } = await supabase
    .from("manufacturing_steps")
    .select("id, task_id")
    .in("task_id", [...liveTaskIds]);

  if (stepError) {
    throw new Error(`Unable to load manufacturing steps: ${stepError.message}`);
  }

  const liveStepIds = new Set((liveSteps ?? []).map((step) => step.id));
  const restorableTools = scopedBackupTools.filter((tool) => liveStepIds.has(tool.step_id));
  const skippedMissingSteps = scopedBackupTools.length - restorableTools.length;
  const skippedMissingTasks = backupTools.length - scopedBackupTools.length;

  const { data: existingTools, error: existingError } = await supabase
    .from("step_tools")
    .select("id")
    .in("task_id", [...liveTaskIds]);

  if (existingError) {
    throw new Error(`Unable to read current step_tools: ${existingError.message}`);
  }

  const existingIds = new Set((existingTools ?? []).map((tool) => tool.id));
  const missingTools = restorableTools.filter((tool) => !existingIds.has(tool.id));

  const report = {
    mode: apply ? "apply" : "dry-run",
    backupDir,
    targetProjectId,
    backupToolRows: backupTools.length,
    liveStepToolsBefore: existingTools?.length ?? 0,
    restorableToolRows: restorableTools.length,
    missingToolRows: missingTools.length,
    skippedMissingTasks,
    skippedMissingSteps,
    sampleMissing: missingTools.slice(0, 5).map((tool) => ({
      task_id: tool.task_id,
      step_id: tool.step_id,
      tool_name: tool.tool_name,
    })),
  };

  if (apply && missingTools.length) {
    const { error: upsertError } = await supabase.from("step_tools").upsert(
      missingTools.map((tool) => ({
        id: tool.id,
        task_id: tool.task_id,
        step_id: tool.step_id,
        tool_name: tool.tool_name,
        sequence: tool.sequence,
        created_at: tool.created_at,
        updated_at: tool.updated_at,
      })),
    );

    if (upsertError) {
      throw new Error(`Unable to restore step tools: ${upsertError.message}`);
    }

    const { count: liveCount, error: countError } = await supabase
      .from("step_tools")
      .select("*", { count: "exact", head: true })
      .in("task_id", [...liveTaskIds]);

    if (countError) {
      throw new Error(`Restore completed but verification failed: ${countError.message}`);
    }

    report.liveStepToolsAfter = liveCount ?? null;
    report.restoredToolRows = missingTools.length;
  }

  console.log(JSON.stringify(report, null, 2));

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to upsert missing step_tools rows.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
