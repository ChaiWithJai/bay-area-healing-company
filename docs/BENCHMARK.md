# Laptop benchmark evidence

The final Bonsai development campaign passed all 15 synthetic tasks against independent output references. Each ordinary workflow produced its required artifacts. The ordinary case task normalized all 40 notes with no retries. Stewardship is a completed review draft, not an enacted legal structure.

Hardware: M4 Pro, 24GB unified memory. Runtime: Ollama 0.33.3; Bonsai 8B Q1_0, installed artifact about 1.16GB, context 4096, output limit 1024, temperature zero. These are measured local model requests; the application made no cloud inference calls. Codex was used separately to develop the software.

| Ordinary task | Requests | Inference seconds | Input tokens | Output tokens |
| --- | ---: | ---: | ---: | ---: |
| volunteer_hours_reconciliation | 1 | 1.47 | 115 | 107 |
| case_note_normalization | 40 | 42.50 | 6880 | 2587 |
| board_report_synthesis | 4 | 4.65 | 668 | 225 |
| grant_cycle_package | 3 | 3.23 | 599 | 117 |
| stewardship_structuring | 2 | 3.55 | 456 | 179 |

Inference seconds sum measured request durations, including any repair. They exclude document preparation/rendering and human review; they are not end-to-end labor savings. The complete development campaign used 154 requests, 26,791 reported input tokens and 9,826 output tokens over 163.63 seconds of measured inference. All failures and repairs remain in these totals. Cached tokens are reported separately and are not added again.

The case run's sampled coordinator peak RSS was about 117 MB and all recognized inference processes together peaked at about 3.02 GB. This is a sampled process inventory, not model-exclusive accelerator allocation. Host swap reflected other activity, including the earlier 27B probe; all 44 case-run pressure samples were normal. No electricity, energy, hardware amortization or reviewer-time costs were measured.

See [machine-readable development results](results/dev-bonsai8-v4.json), [actual demo artifacts](../examples/README.md), [accounting definitions](ACCOUNTING.md), and [fixture review](FIXTURE-REVIEW.md).

## What the evidence does and does not establish

These are generated fictional examples of supported contracts. Reference checking is independent of the engine's pass flag, but references were not supplied by domain experts. Test success establishes behavior on this corpus. It does not establish grant competitiveness, clinical/casework quality, legal correctness, or real-world acceptance rates. The stewardship held-out inputs duplicate development inputs and establish repeatability only. Other held-out variants also share construction patterns, so a permissioned historical-data pilot is needed before broader reliability claims.

The earlier 27B MLX structured probe failed, while its load coincided with memory-pressure warnings and roughly 4.77 GB of host swap. It was unloaded. That single experiment is a reason to defer that configuration on this laptop, not proof that every 27B model or quantization is impossible. Qwen 3.8 27B was not installed or tested.

## Development model comparison

Both profiles used identical task construction, rubric, 4096-token context configuration and 1024-token output cap. Named-profile evaluations disabled fallback. Bonsai passed 15/15 reference outcomes in 163.63 seconds of measured inference; Qwen 2.5 7B Q4_K_M passed 11/15 in 790.92 seconds. Qwen failed the ordinary board case and all three stewardship cases. These figures include retries and failures, rather than only successful answers.

The development-only [routing report](results/routing-development.json) proposes Bonsai for all five task families. Qwen met the three-scenario criterion for participation, case notes and grants, with higher mean inference times. Recommendations are read-only; they do not automatically certify a profile or rewrite configuration. The runtime's configured alternative remains a bounded experimental fallback, not a claim that it is stronger on every family.

After development, a conservative byte-based context guard was added. All 154 retained Bonsai request prompts and 143 retained Qwen complete-response prompts passed read-only revalidation, with a maximum of 1337 content bytes. Request construction and model settings did not change. [Guard revalidation](results/context-guard-revalidation.json) records both source digests; subsequent held-out campaigns record the new digest. Failed/truncated requests without retained complete-response traces are excluded from that revalidation count, not from usage accounting.

## Bonsai repeated held-out results

All 45 runs passed reference checks: three repetitions of each of 15 held-out task cards. This used 462 local requests, 80,373 reported input tokens and 29,487 output tokens, totaling 491.62 seconds of measured inference. The implementation and task instructions were unchanged during these runs.

| Family | Reference passes | Mean inference seconds | Observed range, seconds |
| --- | ---: | ---: | ---: |
| volunteer_hours_reconciliation | 9/9 | 1.15 | 0.00–3.37 |
| case_note_normalization | 9/9 | 43.60 | 41.51–45.38 |
| board_report_synthesis | 9/9 | 4.15 | 3.13–4.84 |
| grant_cycle_package | 9/9 | 2.33 | 1.65–3.71 |
| stewardship_structuring | 9/9 | 3.39 | 2.55–4.60 |

[Full held-out results](results/heldout-bonsai8-all-v4.json) retain per-run resource accounting and reference checks. Counts include correct review/abstention for negative cases. Stewardship inputs repeat development data; the remaining held-out inputs share fixture-construction patterns. Three repetitions measure consistency on these tasks, not independent real-world examples.

## Qwen qualified-family repetitions

Qwen passed all 27 held-out checks across case notes, grants and participation: three repetitions of each of nine task cards. Board reporting and stewardship were excluded from this qualified-family run because they failed development qualification; this is not a 27-task all-workflow accuracy claim. These repetitions used 399 requests, 67,551 reported input tokens and 28,479 output tokens over 943.08 seconds of measured inference.

Results: [case notes](results/heldout-qwen7-case_note_normalization-v4.json), [grants](results/heldout-qwen7-grant_cycle_package-v4.json), [participation](results/heldout-qwen7-volunteer_hours_reconciliation-v4.json). Family eligibility was selected from development results before these repetitions.

## Operational routing control

The default operational routing configuration passed all 15 held-out task checks in one additional repetition. It used 158 local requests, 27,538 reported input tokens and 9,940 output tokens over 137.99 seconds of measured inference. Request counts by profile: 154 Bonsai and four Qwen. All four Qwen fallback responses validated, on bounded evidence or abstention steps in conflict/missing-data board, grant and stewardship packets. That does not reverse Qwen’s end-to-end board/stewardship qualification failures. This is a separate policy-control run, not three repetitions. The controlled integration test also verifies one same-profile repair followed by a single alternative, retaining all failed attempts. [Routing-control results](results/heldout-routed-v4.json).

## Standalone setup

After inference validation, the laptop was configured to use its project-local Python 3.14 environment. The same pinned document-library versions passed all 83 tests, including genuine OCR and native artifact handling. Model validation used the earlier bundled Python environment with those same document-library versions. [Installed Python dependencies](build/python-environment.txt) record the standalone environment; no Codex runtime calls are required.
