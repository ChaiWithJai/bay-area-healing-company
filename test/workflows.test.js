import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkflows, findWorkflow } from "../src/workflows/registry.js";
import { runStructuralGates, gatesPassed } from "../src/engine/gates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowsDir = path.join(__dirname, "..", "workflows");

test("bundled workflow registry has all five nonprofit workflows", async () => {
  const specs = await loadWorkflows(workflowsDir);
  const ids = specs.map((s) => s.id).sort();
  assert.deepEqual(ids, [
    "nonprofit/board_report_synthesis",
    "nonprofit/case_note_normalization",
    "nonprofit/grant_cycle_package",
    "nonprofit/stewardship_structuring",
    "nonprofit/volunteer_hours_reconciliation"
  ]);
});

test("every workflow spec declares gates and deliverables", async () => {
  const specs = await loadWorkflows(workflowsDir);
  for (const spec of specs) {
    assert.ok(Array.isArray(spec.deliverable) && spec.deliverable.length > 0, spec.id);
    assert.ok(Array.isArray(spec.gates) && spec.gates.length > 0, spec.id);
  }
});

test("findWorkflow resolves by short id", async () => {
  const spec = await findWorkflow(workflowsDir, "stewardship_structuring");
  assert.equal(spec.id, "nonprofit/stewardship_structuring");
});

test("findWorkflow rejects unknown id", async () => {
  await assert.rejects(() => findWorkflow(workflowsDir, "does_not_exist"));
});

test("structural gates fail closed when deliverables are missing", async () => {
  const spec = { deliverable: ["output/nope.tsv"], gates: [] };
  const results = runStructuralGates(spec, path.join(__dirname, "fixtures", "empty"));
  assert.equal(gatesPassed(results), false);
});
