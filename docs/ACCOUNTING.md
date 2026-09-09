# Local accounting and observability

`src/observability/index.js` exports the durable run store, usage aggregation, privacy-conscious report export, and host resource sampler. Requires a Node version with `node:sqlite` (tested with Node 26).

## Runtime contract

```js
import { RunStore, summarizeUsage, exportReport, startResourceSampler }
  from './src/observability/index.js';
const store = new RunStore('.wm');
store.createRun({ id: 'unique-run', workflow: 'participation', config: {} });
store.updateRun('unique-run', { status: 'running' });
const sampler = startResourceSampler(data => store.event('unique-run', 'resource.sample', data));
store.event('unique-run', 'model.request.finished', {
  attemptId: 'unique-attempt', stepId: 'extract', profile: 'small', model: 'model-name',
  modelDigest: null, engine: 'ollama', success: true, durationMs: 120,
  inputTokens: 30, outputTokens: 10, ttftMs: null
});
await sampler.stop();
store.updateRun('unique-run', { status: 'completed' });
const usage = summarizeUsage(store, { runId: 'unique-run' });
await exportReport(store, 'unique-run', './report');
store.close();
```

`RunStore` methods: `createRun(metadata)`, `getRun(id)`, `listRuns()`, `updateRun(id, patch)`, `event(runId, type, data)`, `events(runId)`, `saveStep(runId, stepId, result)`, `getSteps(runId)`, `close()`. Missing runs return null from `getRun`; unknown IDs on writes reject. `getSteps` returns objects containing `stepId` and result properties. Identity fields cannot be changed. Supported statuses are queued, running, blocked, completed, failed, cancelled. The engine sets completed only after acceptance validation.

SQLite WAL stores run metadata, append-only events, and current step checkpoints. Finished inference event insertion and attempt deduplication share one transaction. Replaying a finished event with the same run and attempt ID does not double count. Different attempts must receive distinct IDs, even when they retry the same step.

Record `model.request.started` durably before dispatch, with the same attempt ID as its eventual terminal event. Usage joins by run ID plus attempt ID. A started request with no terminal event (in flight, SIGKILL, or crash) remains one incomplete attempt with unknown outcome and null metrics, including tokens; it is never silently omitted or asserted failed. Duplicate starts do not inflate counts, and a subsequent finish replaces the incomplete observation. Requests dispatched before a durable start cannot be recovered from these records.

Record failed and cancelled inference attempts too. Preserve server-reported metrics, and leave unavailable values null or omitted. Never manufacture token counts from character lengths. Individual events retain model digests, engine, profile, step, and failure reasons for inspection. Reports group by model name and profile, while detailed traces retain exact fingerprints; comparisons must use matching fingerprints/configurations.

## Interpretation

- Token and duration totals include known observations only. Every metric reports known/total counts and coverage; missing observations never become measured zero.
- The per-accepted-run denominator counts completed workflow deliverables without `result.reviewRequired`. Its numerator includes all workflow attempts, including failed runs and repairs. Qualification and development attempts remain in total usage but are excluded from workflow unit economics. Set `runType: qualification` explicitly for probes; legacy workflow names beginning qualification/qualify/probe also classify as qualification. Qualification totals are separate. It is not an estimate of the work that was avoided.
- Coordinator process RSS and CPU are measured separately from known local model-server processes and host free memory/swap. A bounded `ps` inventory requests executable names, never command arguments; known Ollama, LM Studio, llmster, and llama-server executables seed a parent-PID traversal that includes their descendants. Unknown descendant basenames become `inference-descendant`; no arbitrary paths or executable names are retained. Server RSS and CPU are summed separately. RSS can double-count shared pages; `ps` CPU may reflect process-lifetime averages. These are observed process resources, not causal per-run attribution, and include idle servers and GUI/helper overhead. Descendant discovery can miss detached/reparented backends. RSS is not model loaded size or Apple Silicon total memory: compressed memory, shared pages, and accelerator allocations differ. Compare server-reported loaded-model bytes as a separately labeled metric when available; never equate them with RSS. Accelerator allocations are not measured. Document-tool subprocess memory is not separately attributed; tool wall time is logged. Process CPU percentages use the operating system process convention and can exceed 100% when several cores or processes are active; they are not a normalized share of whole-machine capacity. Host metrics include unrelated processes. On supported macOS versions, `kern.memorystatus_vm_pressure_level` reports normal/warning/critical with the method labeled; unsupported systems remain null.
- Resource samples occur initially, every two seconds by default (one second minimum), and at termination; observed coordinator/server RSS peaks are lower bounds. Slow samples are skipped rather than queued indefinitely. Very short spikes can be missed. Stop and await the sampler before closing the store; repeated stops return the same result. An unavailable process inventory is null, distinct from a successful inventory that found zero matching processes.
- Energy, electricity cost, hardware amortization, labor, and inference charges remain null. Absence of an API call does not make electricity, hardware, or labor free. The report explicitly states whether saved local-only/cloud-disabled policy and local loopback provider profiles substantiate no configured paid runtime API. This is configuration evidence, not network capture or billing measurement; currency fields remain unknown. Missing policy evidence produces unknown, not a no-API claim.
- `development.*` events are counted separately. Record build tasks, commits, tests, model identifiers, and exposed developer-tool usage as development events. Shared subscription account snapshots do not establish build-attributable tokens and do not enter runtime inference totals.

## Privacy, exports and retention

`report.json`, `usage.csv`, and `report.md` include only allowlisted run identity, hardware/version provenance, and aggregate accounting. They exclude raw source inputs, model content, configuration, paths, event error text, and free-form run notes. Exported identifiers and model names should still be reviewed before publication.

The local database is an inspectable operational record, not a public export. Obvious secret-bearing configuration keys are removed recursively; arbitrary prose is not a secret detector. Do not place secrets or unnecessary personal content in event payloads. Raw model output under an ordinary output field may be retained locally, so use artifact references where possible. State directories are created private, and reports are created with owner-only mode. No automatic retention deletion runs; back up or remove the state directory deliberately after closing all store connections. Existing filesystem permissions are not rewritten.

## Verification

`node --test test/accounting.test.js` exercises durable checkpoints, identity constraints, redaction, duplicate attempts, retries, cancellations, partial metric coverage, denominator behavior, atomic foreign-key failures, export privacy, and sampler shutdown. Integration must establish that every dispatched request emits its terminal attempt event and every completion follows real acceptance gates.

## Read-only fleet campaign report

Run `node scripts/fleet-report.mjs CAMPAIGN.json [CAMPAIGN.json ...]` for JSON, or add `--markdown` for a readable comparison. Inputs may be saved evaluation-campaign files from `.wm/evaluations` or exported campaign JSON retaining their slots and usage records. A standalone run `report.json` lacks campaign/reference provenance and is not accepted. Output goes to stdout; the script never changes configuration, reads credentials, contacts workers, or resumes jobs.

Only completed campaigns with every slot finished are accepted. Repeated run identities reject to avoid duplicate accounting. Comparability requires present and matching source/configuration/rubric/catalog/split identifiers, the same task/repetition multiset, and fixed matching reference digests. Otherwise the report explicitly says non-comparable and explains why. A single campaign is descriptive. Even comparable campaigns produce no routing recommendation; use the separate development-only routing report for that purpose.

The report groups campaign/profile/workflow and then worker usage. A worker's reference-pass figure means a passing run **involved that worker**; it does not establish that worker alone caused success. Mixed-worker involvement counts must not be summed into unique completed workflows. Attempts and token/duration coverage use saved aggregate accounting, including failed, cancelled and incomplete attempts. Missing run accounting is separately counted. Measured inference time is not end-to-end latency or isolated SSH/network overhead.

Coordinator process/server RSS and worker before/after snapshot RSS have separate labels and never fill each other's missing values. Reported peaks are observed lower bounds, not complete model or accelerator allocation; absent remote samples remain null. No remote measurements are manufactured from model loaded size or host RAM. Costs remain unavailable, and synthetic reference passes are not human reliability or expert qualification. Stewardship’s existing held-out cases repeat development inputs.

Exports retain safe configured worker/profile/campaign labels only. They omit source paths, artifact paths, raw documents, SSH hosts, usernames, arbitrary sample payloads, and full configuration. Review configured labels before public sharing. Validation is in `test/fleet-report.test.js`, using the current `summarizeUsage` per-worker schema and tests for incomplete/missing accounting, privacy, completed-campaign gating, fixed provenance, and mismatched comparisons.

## Capacity telemetry interpretation

Telemetry admission uses only fresh, known CPU utilization and **native normal memory pressure**. Monitor free-text planning is discarded; it is not an instruction, executable plan, capacity reservation, or authority to override native pressure. GPU utilization/capacity remains unknown. The local CPU fallback measures a short aggregate CPU-counter delta rather than claiming instantaneous utilization. The remote monitor must identify itself as `local.laptop-context-agent` before context is read over SSH.

Memory byte totals remain as supplied; telemetry never silently assumes a 4KB page size on a 16KB-page host. Disk bytes also remain as supplied. If a reported disk percent differs from used/total by more than one percentage point, or used/total bytes are impossible, the percent becomes null and `disk.consistency` becomes `inconsistent`. This preserves evidence of the discrepancy instead of presenting a contradictory percentage as trustworthy. Disk telemetry is not an admission capacity guarantee; the current decision covers CPU/native-memory-pressure screening only.

Admission emits `admission.wait.started` with waitId/workerId, `admission.checked` with checkId/waitId/workerId/admit/durationMs, and `admission.wait.finished` with waitId/workerId/status/durationMs. Disabled admission emits `admission.skipped`. The usage report joins checks and waits by run plus check/wait identity, so duplicate event delivery does not inflate totals. An unmatched wait start remains incomplete with unknown duration; it is not a failed inference attempt.

The `admission` summary reports checks, denials, admitted/blocked/cancelled/invalid/incomplete waits, skips, timing coverage, and per-worker totals. `admission.csv` exports those totals separately from model usage. Wait duration includes telemetry reads and polling; check duration is a subset and must **not** be added to it. Neither duration becomes inference time or tokens. Free-text reasons and complete telemetry payloads are not included in the public aggregate export. A telemetry denial before dispatch consumes no model attempt, but its observed admission wait remains visible.
