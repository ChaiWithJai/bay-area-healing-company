# PAIR integration decision

Research checked September 6, 2026. Keep the working SSH transport for the first measured two-Mac qualification. Pilot NVIDIA Personal AI Router (PAIR) as a separate transport after this baseline, with the GB10 as the next fleet member when prepared. The application retains responsibility for selecting a model, enforcing evidence gates and deciding when a failed unit needs escalation.

NVIDIA describes PAIR as beta software and lists Mac M4-or-newer and DGX Spark/GB10 among validated hardware. Its documented engines are Ollama and LM Studio; standalone MLX is not a documented engine integration. Our exact Qwen MLX model through LM Studio therefore needs an actual PAIR test. Hardware compatibility alone is insufficient. Sources: [product](https://www.nvidia.com/en-us/ai-on-rtx/personal-ai-router/), [official repository](https://github.com/NVIDIA/Personal-AI-Router), [engine lifecycle](https://docs.nvidia.com/local-ai/nvpair/engine-lifecycle/).

PAIR routes complete independent requests among machines hosting the requested model. It does not combine their RAM, shard a model, migrate a running inference, or decide that a difficult task needs a larger model. That distinction fits this application: the workflow router chooses a qualified model profile, and a fleet transport finds an eligible owner. Source: [overview](https://docs.nvidia.com/local-ai/nvpair/).

Its additions over explicit SSH are discovery, paired-node inventory, engine lifecycle controls, workload visibility and routing among owners of the same model. Applications use their local node's loopback proxy; inter-node inference uses mutual TLS with pinned certificates. Telemetry is a separate unauthenticated LAN surface. Source: [architecture](https://docs.nvidia.com/local-ai/nvpair/architecture/).

PAIR's documented scheduling uses queued/running jobs and coarse GPU utilization. It does not incorporate available memory, measured latency, request size or whether a model is warm. NVIDIA also documents Grace-Blackwell memory-reporting behavior and limitations in stuck-service detection and headless workload attribution. Our measured acceptance, latency, failed-attempt accounting and resource coverage remain necessary. Source: [known issues](https://docs.nvidia.com/local-ai/nvpair/known-issues/).

## Pilot acceptance

1. Pin the same PAIR version on participating machines and preserve the direct-SSH baseline. Record the proxy endpoints PAIR actually displays; it can rearrange engine ports. [Setup](https://docs.nvidia.com/local-ai/nvpair/getting-started/).
2. Verify the exact installed model, quantization, runtime, structured-output behavior and real serving host. Do not assign a local host's measurements to a request PAIR served elsewhere.
3. Run the same workflow inputs and independent reference checks. Compare transport overhead, failure recovery, token coverage and delivered artifacts. Neither an HTTP success nor cross-model agreement proves correctness.
4. Demonstrate cancellation and worker loss. Preserve partial or unknown usage rather than silently replaying an uncertain request as though it cost nothing.
5. Add per-worker slots before claiming parallel fleet throughput; the existing global coordinator lock currently serializes application workflows.
6. Qualify the GB10's CUDA model independently of the Mac's MLX artifact. Even identically named models remain different runtime profiles.

This is an integration decision and acceptance plan, not a claim that PAIR is installed or verified in this fleet. No consumer Codex subscription is used as an application inference endpoint. Astra remains the development architect and debugger in the Codex session.
