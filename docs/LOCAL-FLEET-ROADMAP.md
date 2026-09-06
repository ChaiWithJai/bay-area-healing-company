# From one laptop to a local fleet

The purpose is to turn recurring accountability work into inspectable records and deliverables, with evidence of accuracy and resource consumption. Model size is an implementation choice. Source records, domain checks, human decisions, and measured operating costs determine whether the work is useful.

## What is established

The M4 Pro with 24 GB runs the coordinator, document tools, SQLite ledger, and local small-model inference. An authenticated SSH stdio relay now connects it to a physical M5 Pro with 48 GB, serving an installed Qwen3.8 27B MLX 4-bit model through LM Studio with reasoning disabled. Model servers remain on worker loopback.

Both configurations completed fixed development campaigns covering three cards for each of the five workflows. Each passed the synthetic reference on 15/15 runs, with seven completed deliverables and 11 correct review/abstention outcomes; those latter counts overlap. Bonsai 8B recorded 154 attempts, including nine failures, and 134.259 seconds of summed request time. Remote Qwen recorded 149 attempts, no failed attempts, and 881.242 seconds. These are complete-configuration measurements, including SSH overhead, not isolated model-speed or end-to-end throughput claims. See the [comparison and caveats](results/two-mac-development-comparison.md).

The immediate evidence favors the small model for these development cards while retaining the larger local model as a candidate for difficult work. It does not establish production reliability or held-out fleet success. The synthetic references are unreviewed; stewardship's repeated held-out inputs cannot demonstrate generalization.

## Placement and responsibility

| Component | Current or proposed role | Evidence still needed |
| --- | --- | --- |
| M4 coordinator | Prepare sources, validate evidence, render artifacts, retain traces and accounting | Continued resume/cancellation verification after concurrency changes |
| M4 Bonsai 8B | Bounded extraction and evidence selection; development default candidate | Frozen held-out repetitions and final routing qualification |
| M5 Qwen3.8 27B MLX | Qualified for development workflows over SSH; larger local alternative | Live capacity-aware routing, simultaneous use, held-out comparison |
| Dell GB10 | Later larger or higher-precision model host | Authenticated inventory, runtime/artifact qualification, workload and resource measurements |
| Astra through Codex | Software architecture, implementation, debugging, testing, and review | Concrete development artifacts and tests; no application inference role |
| Human owner | Resolve source ambiguity and consequential decisions; review references and value | Recorded review and observed human-time baseline |

No memory is pooled across these machines. Moving a request to the M5 or GB10 means the whole inference runs on that machine. Local-model operation requires no paid inference API; energy, hardware, and labor costs remain separate, unmeasured or assumption-based quantities rather than zero.

## Capacity and coordination

The M5 monitor's manifest, hello, context, metrics, health, and messages routes were verified. The messages route echoes/replies with context; it is not a task dispatcher. The application reads only the verified manifest and typed context through SSH. Monitor prose cannot change routing policy. The [two-Mac setup guide](TWO-MAC-SETUP.md) records exact routes.

The [monitor correction patch](monitor-telemetry-correction.patch) removes a fixed 4 KB page-size assumption and reads native macOS memory pressure separately. Occupancy percentage is not pressure. Admission requires fresh CPU measurements and native normal pressure; missing, stale, warning, and critical signals deny capacity approval. GPU utilization/capacity remains unknown and is never inferred from memory percentage.

Coordinator-local SQLite run and worker leases now replace the old global workflow lock. Cooperating processes sharing this state directory serialize requests to the same worker, while different workers can overlap. Process tests with controlled providers verify lease exclusion and overlap. This is not a distributed multi-coordinator lock, does not control unrelated applications, and cannot prove a remote backend stopped after a local crash.

Admission integration is opt-in (`admission.enabled: true`) and is being wired inside the worker lease before inference starts. Its bounded wait should record capacity denials separately from model failures and try an eligible configured alternative on another worker. Helper tests exist; runner integration tests and real admission/concurrency verification remain pending. A monitor endpoint responding successfully is not capacity-reservation evidence.

## PAIR integration target

NVIDIA Personal AI Router (PAIR) remains an explicit next integration target rather than a dependency of the working SSH path. NVIDIA's validated configurations include Mac M4-or-newer and DGX Spark/GB10. Its documented engines are Ollama and LM Studio, fitting the engines used here; exact model and stream behavior still need testing through PAIR. [NVIDIA platform support](https://www.nvidia.com/en-us/ai-on-rtx/personal-ai-router/), [supported engines](https://docs.nvidia.com/local-ai/nvpair/engine-lifecycle/).

PAIR adds discovery, model inventory, paired transport, workload visibility, and routing among nodes advertising the requested model. The application must still choose the model family and apply its own evidence gates. PAIR does not shard models or pool memory; a single copy of a model has only one serving location. [Architecture](https://docs.nvidia.com/local-ai/nvpair/architecture/).

A pilot should preserve the SSH transport for comparison, use actual PAIR-displayed local endpoints, verify serving-node attribution and structured streaming, and measure transport overhead and failures on the same cards. PAIR's scheduler does not consider available memory, measured latency, or whether a model is warm, so it does not replace our admission policy or accounting. [Known limitations](https://docs.nvidia.com/local-ai/nvpair/known-issues/).

## Next evidence gates

1. Complete and test opt-in admission: denied capacity causes no inference, wait events remain separate, cancellation releases ownership correctly, and only an eligible different worker is tried.
2. Demonstrate real simultaneous jobs on the two physical Macs, plus serialization for jobs competing for one worker. Preserve host-scoped measurements and attempts.
3. Exercise worker loss, cancelled transport, dead owner recovery, and resumable work without duplicate accepted steps. Treat remote backend cessation as unknown unless observed.
4. Freeze source, profiles, and routing after these changes. Run held-out repetitions for all five workflows and publish failures and correct human-review outcomes alongside completed deliverables.
5. Qualify the GB10 when prepared, then pilot PAIR without changing the workflow/grading contracts. Promote additional capacity only when measurements justify it.

Development qualification is concrete progress. It is not a claim that held-out fleet performance, live concurrent scheduling, or a complete autonomous fleet has been delivered.
