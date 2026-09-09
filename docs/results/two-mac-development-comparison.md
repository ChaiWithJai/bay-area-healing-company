# Fleet accounting comparison

Comparison: comparable-fixed-campaigns.

| Campaign | Reference passes/runs | Completed deliverables | Known attempts | Known inference ms | Input/output token coverage |
|---|---:|---:|---:|---:|---|
| dev-two-mac-bonsai8-v1 | 15/15 | 7 | 154 | 134258.74954499994 | 1 / 1 |
| dev-mac48-qwen27-mlx-v1 | 15/15 | 7 | 149 | 881242.3254189997 | 1 / 1 |

| Campaign / profile / workflow | Worker / transport | Reference-passing runs involving worker | Attempts | Known input/output tokens | Worker RSS sampled peak bytes |
|---|---|---:|---:|---:|---:|
| dev-two-mac-bonsai8-v1 / bonsai8 / volunteer_hours_reconciliation | coordinator / loopback | 2/2 | 2 | 230 / 214 | unknown |
| dev-two-mac-bonsai8-v1 / bonsai8 / case_note_normalization | coordinator / loopback | 3/3 | 121 | 20846 / 7827 | unknown |
| dev-two-mac-bonsai8-v1 / bonsai8 / board_report_synthesis | coordinator / loopback | 3/3 | 14 | 2285 / 750 | unknown |
| dev-two-mac-bonsai8-v1 / bonsai8 / grant_cycle_package | coordinator / loopback | 3/3 | 10 | 1976 / 396 | unknown |
| dev-two-mac-bonsai8-v1 / bonsai8 / stewardship_structuring | coordinator / loopback | 3/3 | 7 | 1454 / 639 | unknown |
| dev-mac48-qwen27-mlx-v1 / mac48-qwen27-mlx / volunteer_hours_reconciliation | mac48 / ssh | 2/2 | 2 | 230 / 208 | 184909824 |
| dev-mac48-qwen27-mlx-v1 / mac48-qwen27-mlx / case_note_normalization | mac48 / ssh | 3/3 | 120 | 20764 / 6999 | 220938240 |
| dev-mac48-qwen27-mlx-v1 / mac48-qwen27-mlx / board_report_synthesis | mac48 / ssh | 3/3 | 12 | 1972 / 501 | 224657408 |
| dev-mac48-qwen27-mlx-v1 / mac48-qwen27-mlx / grant_cycle_package | mac48 / ssh | 3/3 | 9 | 1851 / 356 | 723484672 |
| dev-mac48-qwen27-mlx-v1 / mac48-qwen27-mlx / stewardship_structuring | mac48 / ssh | 3/3 | 6 | 1274 / 464 | 791216128 |

- Reference passes are synthetic rubric outcomes, not human reliability or expert qualification; review/abstention is reported separately from completed deliverables.
- All recorded failures, repairs and incomplete attempts remain included. Unknown usage is not zero. Metric coverage applies to retained accounting; missing runs are separately counted.
- Inference duration is a sum of measured attempts, not end-to-end latency, throughput or separately measured transport overhead.
- A run involving multiple workers contributes to each worker involvement count; worker pass counts cannot be summed into unique successful runs or attributed causally to one worker.
- Coordinator RSS never substitutes for missing worker RSS. Before/after snapshots miss interior peaks; RSS is not full model allocation, compressed memory or accelerator allocation.
- No worker connectivity is tested, configuration changed, profile selected, price inferred or human time savings claimed.
- Stewardship held-out fixtures duplicate development inputs; those results establish repeatability only.
