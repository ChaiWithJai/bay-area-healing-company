import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

/**
 * A workflow is a spec (JSON) describing an ALE-style task card:
 * inputs, deliverables, gates (binary, checked first) and a score
 * (continuous, only computed once gates pass). The manager treats the
 * thing that actually produces the deliverable as a black box — a
 * human, a script, or an AI provider — the contract is the same either
 * way. See docs/ARCHITECTURE.md.
 */
export async function loadWorkflows(dir) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const specs = [];
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), "utf8");
    try {
      specs.push(JSON.parse(raw));
    } catch (err) {
      throw new Error(`could not parse workflow spec ${file}: ${err.message}`);
    }
  }
  return specs.sort((a, b) => a.id.localeCompare(b.id));
}

export async function findWorkflow(dir, id) {
  const specs = await loadWorkflows(dir);
  const spec = specs.find((s) => s.id === id || s.id.endsWith(`/${id}`));
  if (!spec) {
    throw new Error(
      `unknown workflow "${id}". Run \`wm workflow list\` to see available ids.`
    );
  }
  return spec;
}
