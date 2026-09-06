# From one laptop to a local fleet

The purpose is to turn recurring accountability work into inspectable records and deliverables, with evidence of accuracy and resource consumption. Model size is an implementation choice. Source records, domain checks, human decisions, and measured operating costs determine whether the work is useful.

## What is established

The M4 Pro with 24 GB runs the coordinator, document tools, SQLite ledger, and local small-model inference. An authenticated SSH stdio relay now connects it to a physical M5 Pro with 48 GB, serving an installed Qwen3.8 27B MLX 4-bit model through LM Studio with reasoning disabled. Model servers remain on worker loopback.

Both configurations completed fixed development campaigns covering three cards for each of the five workflows. Each passed the synthetic reference on 15/15 runs, with seven completed deliverables and 11 correct review/abstention outcomes; those latter counts overlap. Bonsai 8B recorded 154 attempts, including nine failures, and 134.259 seconds of summed request time. Remote Qwen recorded 149 attempts, no failed attempts, and 881.242 seconds. These are complete-configuration measurements, including SSH overhead, not isolated model-speed or end-to-end throughput claims. See the [comparison and caveats](results/two-mac-development-comparison.md).

The immediate evidence favors the small model for these development cards while retaining the larger local model as a candidate for difficult work. The final routed held-out campaign passed 15/15 on these fixtures; neither result establishes production reliability. The synthetic references are unreviewed; stewardship's repeated held-out inputs cannot demonstrate generalization.

## Placement and responsibility

| Component | Current or proposed role | Evidence still needed |
| --- | --- | --- |
| M4 coordinator | Prepare sources, validate evidence, render artifacts, retain traces and accounting | Graceful recovery verified; hard failures remain quarantined until explicit clearance |
| M4 Bonsai 8B | Bounded extraction and evidence selection; development default candidate | 45/45 final routed references verified across three repetitions |
| M5 Qwen3.8 27B MLX | Qualified for development workflows over SSH; larger local alternative | Capacity-aware concurrency verified with remote Qwen 7B; 27B first-pass references 43/45 across three repetitions; two telemetry deferrals recovered |
| Dell GB10 | Later larger or higher-precision model host | Authenticated inventory, runtime/artifact qualification, workload and resource measurements |
| Astra through Codex | Software architecture, implementation, debugging, testing, and review | Concrete development artifacts and tests; no application inference role |
| Human owner | Resolve source ambiguity and consequential decisions; review references and value | Recorded review and observed human-time baseline |

No memory is pooled across these machines. Moving a request to the M5 or GB10 means the whole inference runs on that machine. Local-model operation requires no paid inference API; energy, hardware, and labor costs remain separate, unmeasured or assumption-based quantities rather than zero.

## Capacity and coordination

The M5 monitor's manifest, hello, context, metrics, health, and messages routes were verified. The messages route echoes/replies with context; it is not a task dispatcher. The application reads only the verified manifest and typed context through SSH. Monitor prose cannot change routing policy. The [two-Mac setup guide](TWO-MAC-SETUP.md) records exact routes.

The [monitor correction patch](monitor-telemetry-correction.patch) removes a fixed 4 KB page-size assumption and reads native macOS memory pressure separately. Occupancy percentage is not pressure. Admission requires fresh CPU measurements and native normal pressure; missing, stale, warning, and critical signals deny capacity approval. GPU utilization/capacity remains unknown and is never inferred from memory percentage.

Coordinator-local SQLite run and worker leases now replace the old global workflow lock. Cooperating processes sharing this state directory serialize requests to the same worker, while different workers can overlap. Process tests with controlled providers verify lease exclusion and overlap. This is not a distributed multi-coordinator lock, does not control unrelated applications, and cannot prove a remote backend stopped after a local crash.

Admission is opt-in (`admission.enabled: true`) and runs inside the worker lease before inference starts. Its bounded wait records capacity denials separately from model failures and can try a configured alternative on another worker. Integration tests and actual two-Mac concurrency pass. Dead worker ownership and incomplete generation streams persistently quarantine the worker rather than assuming its backend stopped. A monitor endpoint responding successfully is not capacity-reservation evidence.

## PAIR integration target

NVIDIA Personal AI Router (PAIR) remains an explicit next integration target rather than a dependency of the working SSH path. NVIDIA's validated configurations include Mac M4-or-newer and DGX Spark/GB10. Its documented engines are Ollama and LM Studio, fitting the engines used here; exact model and stream behavior still need testing through PAIR. [NVIDIA platform support](https://www.nvidia.com/en-us/ai-on-rtx/personal-ai-router/), [supported engines](https://docs.nvidia.com/local-ai/nvpair/engine-lifecycle/).

PAIR adds discovery, model inventory, paired transport, workload visibility, and routing among nodes advertising the requested model. The application must still choose the model family and apply its own evidence gates. PAIR does not shard models or pool memory; a single copy of a model has only one serving location. [Architecture](https://docs.nvidia.com/local-ai/nvpair/architecture/).

A pilot should preserve the SSH transport for comparison, use actual PAIR-displayed local endpoints, verify serving-node attribution and structured streaming, and measure transport overhead and failures on the same cards. PAIR's scheduler does not consider available memory, measured latency, or whether a model is warm, so it does not replace our admission policy or accounting. [Known limitations](https://docs.nvidia.com/local-ai/nvpair/known-issues/).

## Current evidence and remaining qualification

[Two-Mac results](TWO-MAC-RESULTS.md) records 144 passing implementation/reporting tests, 45/45 final held-out routed references across three repetitions, concurrent grant artifacts passing on both Macs, and remote checkpoint recovery without duplicate accepted work. The final live reports share a source digest. Controlled process tests cover dead-owner quarantine; graceful live cancellation does not claim an orphaned backend was forcibly stopped.

Remaining qualification work:

1. Routed repeatability is complete at 45/45; preserve its failures, repairs, 12 larger-model fallback responses and review outcomes.
2. Larger-model testing is complete at 43/45 first-pass references, with two capacity deferrals recovered separately. Keep operating availability and model-output validation distinct.
3. Qualify the GB10 when prepared, including Linux-native memory/GPU admission telemetry: the current pressure contract is macOS-specific. Then pilot PAIR without changing workflow or grading contracts.
4. Obtain independently reviewed, permissioned operational data and human-time baselines before production or savings claims.

The current software uses one coordinator and two local inference workers. It does not claim pooled memory, a tested PAIR deployment, or independently autonomous coordinators.
