import path from "node:path";
import { parseArgs } from "node:util";
import { loadWorkflows, findWorkflow } from "../workflows/registry.js";
import { runWorkflow } from "../engine/runner.js";

export async function cmdWorkflowList(config) {
  const specs = await loadWorkflows(config.workflowsDir);
  if (specs.length === 0) {
    console.log(`no workflows found in ${config.workflowsDir}`);
    return;
  }
  for (const spec of specs) {
    console.log(`${spec.id}\t${spec.name}`);
  }
}

export async function cmdWorkflowShow(config, id) {
  if (!id) throw new Error("usage: wm workflow show <id>");
  const spec = await findWorkflow(config.workflowsDir, id);
  console.log(JSON.stringify(spec, null, 2));
}

export async function cmdWorkflowRun(config, rest, fullArgv) {
  const id = rest[0];
  if (!id) throw new Error("usage: wm workflow run <id> [--provider name] [--input-dir path] [--output-dir path]");

  const { values } = parseArgs({
    args: fullArgv,
    options: {
      provider: { type: "string" },
      "input-dir": { type: "string" },
      "output-dir": { type: "string" }
    },
    allowPositionals: true,
    strict: false
  });

  const spec = await findWorkflow(config.workflowsDir, id);
  const shortId = spec.id.split("/").pop();
  const inputDir = values["input-dir"] ?? path.join("inputs", shortId);
  const outputDir = values["output-dir"] ?? path.join(config.outputDir ?? "output", shortId);

  console.log(`running ${spec.id} via ${values.provider ?? config.defaultProvider}`);
  console.log(`  inputs:  ${inputDir}`);
  console.log(`  outputs: ${outputDir}`);

  const result = await runWorkflow({
    spec,
    config,
    providerName: values.provider,
    inputDir,
    outputDir
  });

  console.log("");
  console.log(`provider: ${result.provider} (${result.model})`);
  if (result.missingDeliverables.length > 0) {
    console.log(`missing deliverables: ${result.missingDeliverables.join(", ")}`);
  }
  console.log("gates:");
  for (const gate of result.gateResults) {
    const mark = gate.pass === null ? "?" : gate.pass ? "x" : " ";
    console.log(`  [${mark}] ${gate.id} — ${gate.detail}`);
  }
  console.log("");
  console.log(`raw provider output logged at ${result.rawLogPath}`);
  console.log(
    result.passed
      ? "structural gates: PASS (domain-specific gates still need encoding — see docs/ARCHITECTURE.md)"
      : "structural gates: FAIL"
  );

  if (!result.passed) process.exitCode = 1;
}
