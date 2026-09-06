# M5 worker API observations

The worker service evolved during qualification. Its manifest still reports `local.laptop-context-agent` version `0.1.1`, but now advertises jobs and capacity in addition to the earlier context routes. The observed server source changed to SHA-256 `b364bbc78edcaee2a708fb21eb781fba388986c6491bbe00dc556d6979db8137`, with a modification time of 2026-09-06 19:13 UTC. This is a separate service from the frozen workflow-manager source.

| Method | Route | Observed behavior |
| --- | --- | --- |
| GET | `/api/capacity` | Typed memory pressure, adapter readiness, reservation counts, queue depth and admission decision; tested with HTTP 200 |
| POST | `/api/jobs` | Validates a job, reserves adapter capacity and starts asynchronous execution; an empty request was tested and rejected with HTTP 400 |
| GET | `/api/jobs` | Source implements listing recent jobs; unrelated job content was not fetched |
| GET | `/api/jobs/:id` | Job status/result; a deliberately nonexistent ID returned JSON HTTP 404 |
| POST | `/api/jobs/:id/cancel` | Cancellation request; a deliberately nonexistent ID returned JSON HTTP 404 without cancelling any job |
| GET | `/api/artifacts/:id` | Generated artifact; a deliberately nonexistent ID returned JSON HTTP 404 |
| POST | `/api/a2a/messages` | Remains a separate message/context endpoint; it is not the job submission route |

No inference job was submitted through this new API during these route checks. The existing application continues to use authenticated SSH for inference and the verified context endpoint for telemetry.

## Current text-job contract

Source inspection shows this shape:

```json
{
  "idempotencyKey": "unique-request-id",
  "operation": "text.generate",
  "adapter": "lm-studio",
  "model": "observed-model-id",
  "input": {"messages": [{"role": "user", "content": "bounded input"}]},
  "limits": {"timeoutSeconds": 90, "maxOutputTokens": 1024}
}
```

The observed adapters are `bonsai-text`, `bonsai-image`, `ollama` and `lm-studio`. Readiness and reservations are adapter-specific. A reservation count of zero does not include requests made directly through the workflow manager's SSH relay or other applications, so it does not establish global backend idleness.

## Compatibility work before changing transport

The current text adapter forwards model, messages and maximum output tokens with streaming disabled. It does not forward the tested JSON schema, temperature or `reasoning_effort` controls. Therefore it cannot yet preserve the qualified Qwen 27B profile's request contract. The worker also needs equivalent local-model identity checks before it can replace the application's rejection of remote-backed model profiles.

Reservations are released after client-side cancellation or failure. That is insufficient to establish backend termination, which is why the workflow manager retains persistent quarantine for uncertain streams. Before integrating this dispatcher, verify idempotency under conflicting payloads, restart recovery, bounded response handling and cancellation against actual backend state, then repeat structured-output and accounting checks through the new path.

The worker's capacity policy can decline heavy work while native memory pressure remains normal. Its policy and adapter reservations are distinct from the workflow manager's documented native-pressure/CPU screening and coordinator-local leases. A future bridge must reconcile those policies explicitly; current reservation counts must not be presented as reservations for SSH work.

## Observed interruption and recovery

One repeated case-note run received unavailable/untrusted telemetry for its 30-second admission budget. It retained 39 accepted notes and made **zero** model requests for the remaining note. The first-pass reference consequently failed, as it should for incomplete output.

The [recovery receipt](results/two-mac-capacity-recovery.json) shows all 39 accepted attempt IDs preserved, one new request for the missing step, and a passing artifact reference afterward. The original campaign slot remains unchanged and failed; recovery is not counted as another independent repetition. The service changed during the campaign, but the retained evidence does not prove the precise cause of that temporary telemetry failure.

A second repeated run later deferred a different note for unavailable telemetry. Its [separate recovery receipt](results/two-mac-capacity-recovery-2.json) likewise retains 39 accepted attempt IDs, uses exactly one new model request and passes the artifact reference. Both original failed campaign slots remain unchanged.
