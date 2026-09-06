# From one laptop to a local fleet

The practical opportunity is inexpensive, inspectable work on recurring accountability tasks. The motivating problem is the gap between producing plausible documents and maintaining trustworthy records that survive staff turnover. Gates, evidence and review decisions are durable organizational assets; model choices are replaceable implementation details.

Today the M4 Pro laptop runs the coordinator, document tools, SQLite ledger and one local inference request at a time. The configured small models were already installed. Bonsai 8B and Qwen 2.5 7B are compared as complete task workers, including their failures and repairs. Parameter count alone is not a routing rule.

The Dell GB10 and 48GB M5 are later workers. The first fleet experiment should preserve the same task contracts and instrumentation while replacing the inference endpoint behind an authenticated local gateway. The current build intentionally rejects non-loopback endpoints, so remote LAN inference requires an explicit implementation and new boundary tests. Do not pretend that simply editing the URL enables the fleet.

PAIR is a candidate for later model placement/routing experiments, not a dependency of this laptop build. Model hosting across machines is not pooled unified memory. Exact runtime support, networking and deployment should be verified when those machines are available. Qwen 3.8 27B is not the same installed artifact as Bonsai 27B; this build does not claim to have tested the former.

An initial fleet could assign these responsibilities:

| Role | Responsibility | Acceptance |
| --- | --- | --- |
| Laptop coordinator | Queue, source preparation, deterministic gates, ledger, CLI | Recover interrupted runs without duplicate accepted work |
| Small local worker | Bounded extraction and evidence selection | Meets measured task-family thresholds |
| GB10 worker | Larger models on difficult work units | Improves reference success enough to justify latency and resources |
| M5 worker | Independent review or overflow | Explicit task lease and identical evidence contracts |
| Astra development session | Architecture, code delegation, debugging, review and release work | Tested patches and concrete artifacts |
| Human owner | Correct source records, approve domain decisions, validate value | Recorded review and measured baseline time |

Astra is not an invisible application runtime. Development progress here depends on this Codex session; ongoing fleet coordination belongs in the software with durable state. No application calls are routed through a consumer subscription or undocumented endpoint.

Promotion policy: qualify an installed artifact, run development cases, freeze instructions and routing, then run the held-out repetitions. Prefer the least resource-intensive profile that meets the task's accuracy and latency needs. Escalate only failed bounded units with explicit reasons. Stop after the configured attempts and return evidence plus a review request. Keep cross-model agreement distinct from correctness: both models can repeat the same mistake.
