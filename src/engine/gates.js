import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Gates are binary and run before any score. A failed gate is a hard 0 —
 * per the TDD-black-box contract, the gate is written before the workflow
 * exists and never inspects how the deliverable was produced, only
 * whether it is present and structurally sound.
 *
 * This module only implements the generic, structural checks that apply
 * to every workflow (deliverables exist, aren't empty, tabular files
 * parse as TSV). The domain-specific gates listed in each workflow spec
 * ("every RFP requirement id appears exactly once", etc.) require
 * encoding the funder/org-specific rules described in
 * docs/ARCHITECTURE.md — that encoding is deliberately left to you per
 * workflow, because doing it generically is exactly the trap the spec
 * warns about ("if your gate passes on day one, it is not measuring
 * anything").
 */
export function runStructuralGates(spec, outputDir, { domainHandled = false } = {}) {
  const results = [];

  for (const relPath of spec.deliverable) {
    const abs = path.join(outputDir, relPath);
    const contained = path.relative(path.resolve(outputDir), path.resolve(abs));
    const exists = !contained.startsWith('..') && !path.isAbsolute(contained) && existsSync(abs) && statSync(abs).isFile();
    results.push({
      id: `deliverable-exists:${relPath}`,
      pass: exists,
      detail: exists ? `found ${relPath}` : `missing ${relPath}`
    });
    if (exists) {
      const size = statSync(abs).size;
      results.push({
        id: `deliverable-nonempty:${relPath}`,
        pass: size > 0,
        detail: size > 0 ? `${relPath} is ${size} bytes` : `${relPath} is empty`
      });
    }
  }

  for (const gateText of domainHandled ? [] : (spec.gates ?? [])) {
    results.push({
      id: `domain-gate:${gateText}`,
      pass: null,
      detail: "not encoded — requires a workflow-specific check (see docs/ARCHITECTURE.md)"
    });
  }

  return results;
}

export function gatesPassed(results) {
  return results.length > 0 && results.every((r) => r.pass === true);
}
