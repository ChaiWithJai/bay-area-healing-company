import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { getProvider } from "../providers/index.js";
import { runStructuralGates, gatesPassed } from "./gates.js";

const FILE_MARKER = /^===FILE:\s*(.+?)\s*===$/;

function buildPrompt(spec, inputsSummary) {
  return [
    `You are executing the workflow "${spec.name}" (${spec.id}).`,
    "",
    `Task: ${spec.task}`,
    "",
    "Expected inputs (raw contents/summaries below, some may be absent — flag anything missing as an exception rather than inventing it):",
    inputsSummary || "(no input files found — proceed only where the task allows it, otherwise emit exceptions)",
    "",
    `Required deliverables, each must be produced verbatim under its own marker line:`,
    spec.deliverable.map((d) => `  - ${d}`).join("\n"),
    "",
    "Hard gates this output must satisfy (a failure here is scored zero, not partial credit):",
    (spec.gates ?? []).map((g) => `  - ${g}`).join("\n"),
    "",
    "Output format (required): for EACH deliverable path, emit a line exactly",
    "  ===FILE: <path>===",
    "followed by that file's full content, then the next marker for the next file.",
    "Do not add commentary outside the file blocks. Never fabricate a value you cannot",
    "trace to an input — when in doubt, route the record to an exceptions/conflicts file instead."
  ].join("\n");
}

async function summarizeInputs(inputDir) {
  if (!existsSync(inputDir)) return "";
  const entries = await readdir(inputDir, { withFileTypes: true });
  const parts = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const p = path.join(inputDir, entry.name);
    let content;
    try {
      content = await readFile(p, "utf8");
    } catch {
      content = "(binary or unreadable — provide a text extract for real runs)";
    }
    const truncated = content.length > 4000 ? `${content.slice(0, 4000)}\n... [truncated]` : content;
    parts.push(`--- ${entry.name} ---\n${truncated}`);
  }
  return parts.join("\n\n");
}

function parseDeliverables(raw, spec) {
  const files = new Map();
  let currentPath = null;
  let buffer = [];
  const flush = () => {
    if (currentPath) files.set(currentPath, buffer.join("\n").trim());
    buffer = [];
  };
  for (const line of raw.split("\n")) {
    const match = line.match(FILE_MARKER);
    if (match) {
      flush();
      currentPath = match[1];
    } else if (currentPath) {
      buffer.push(line);
    }
  }
  flush();

  const missing = spec.deliverable.filter((d) => !files.has(d));
  return { files, missing };
}

/**
 * Runs one workflow as a black box: inflow (input files) -> provider ->
 * deliverable files on disk -> structural gates -> pass/fail. This is
 * deliberately agnostic about what produced the deliverable (see
 * docs/ARCHITECTURE.md) — the same contract works whether `complete()`
 * is a cloud model, a local model, or a human filling files in by hand
 * and re-running `wm workflow gate` alone.
 */
export async function runWorkflow({ spec, config, providerName, inputDir, outputDir }) {
  const provider = getProvider(config, providerName ?? config.defaultProvider);
  const inputsSummary = await summarizeInputs(inputDir);
  const prompt = buildPrompt(spec, inputsSummary);

  const raw = await provider.complete({
    system:
      "You are a careful accountability-workflow operator. You produce structured, auditable deliverables and never invent facts not present in the inputs.",
    prompt,
    maxTokens: 8192
  });

  const { files, missing } = parseDeliverables(raw, spec);

  await mkdir(outputDir, { recursive: true });
  for (const [relPath, content] of files) {
    const abs = path.join(outputDir, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, `${content}\n`, "utf8");
  }

  const rawLogPath = path.join(outputDir, "_raw_provider_output.md");
  await writeFile(rawLogPath, raw, "utf8");

  const gateResults = runStructuralGates(spec, outputDir);
  return {
    provider: provider.name,
    model: provider.model,
    missingDeliverables: missing,
    gateResults,
    passed: gatesPassed(gateResults) && missing.length === 0,
    rawLogPath
  };
}
