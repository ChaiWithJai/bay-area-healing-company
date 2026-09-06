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
- Coordinator process RSS and CPU are measured separately from known local model-server processes and host free memory/swap. A bounded `ps` inventory requests executable names, never command arguments; known Ollama, LM Studio, llmster, and llama-server executables seed a parent-PID traversal that includes their descendants. Unknown descendant basenames become `inference-descendant`; no arbitrary paths or executable names are retained. Server RSS and CPU are summed separately. RSS can double-count shared pages; `ps` CPU may reflect process-lifetime averages. These are observed process resources, not causal per-run attribution, and include idle servers and GUI/helper overhead. Descendant discovery can miss detached/reparented backends. RSS is not model loaded size or Apple Silicon total memory: compressed memory, shared pages, and accelerator allocations differ. Compare server-reported loaded-model bytes as a separately labeled metric when available; never equate them with RSS. Accelerator allocations are not measured. Host metrics include unrelated processes. On supported macOS versions, `kern.memorystatus_vm_pressure_level` reports normal/warning/critical with the method labeled; unsupported systems remain null.
- Resource samples occur initially, every two seconds by default (one second minimum), and at termination; observed coordinator/server RSS peaks are lower bounds. Slow samples are skipped rather than queued indefinitely. Very short spikes can be missed. Stop and await the sampler before closing the store; repeated stops return the same result. An unavailable process inventory is null, distinct from a successful inventory that found zero matching processes.
- Energy, electricity cost, hardware amortization, labor, and inference charges remain null. Absence of an API call does not make electricity, hardware, or labor free. The report explicitly states whether saved local-only/cloud-disabled policy and local loopback provider profiles substantiate no configured paid runtime API. This is configuration evidence, not network capture or billing measurement; currency fields remain unknown. Missing policy evidence produces unknown, not a no-API claim.
- `development.*` events are counted separately. Record build tasks, commits, tests, model identifiers, and exposed developer-tool usage as development events. Shared subscription account snapshots do not establish build-attributable tokens and do not enter runtime inference totals.

## Privacy, exports and retention

`report.json`, `usage.csv`, and `report.md` include only allowlisted run identity, hardware/version provenance, and aggregate accounting. They exclude raw source inputs, model content, configuration, paths, event error text, and free-form run notes. Exported identifiers and model names should still be reviewed before publication.

The local database is an inspectable operational record, not a public export. Obvious secret-bearing configuration keys are removed recursively; arbitrary prose is not a secret detector. Do not place secrets or unnecessary personal content in event payloads. Raw model output under an ordinary output field may be retained locally, so use artifact references where possible. State directories are created private, and reports are created with owner-only mode. No automatic retention deletion runs; back up or remove the state directory deliberately after closing all store connections. Existing filesystem permissions are not rewritten.

## Verification

`node --test test/accounting.test.js` exercises durable checkpoints, identity constraints, redaction, duplicate attempts, retries, cancellations, partial metric coverage, denominator behavior, atomic foreign-key failures, export privacy, and sampler shutdown. Integration must establish that every dispatched request emits its terminal attempt event and every completion follows real acceptance gates.
