# Two-Mac workflow lab

The M4 Pro 24GB and M5 Pro 48GB now run the workflow manager together. Codex/Astra remains development tooling; the application uses local Ollama and LM Studio inference through loopback or authenticated SSH. No paid runtime provider is configured.

## Verified results

| Requirement | Evidence |
| --- | --- |
| All five workflow families | [Matched development comparison](results/two-mac-development-comparison.md): 15/15 reference passes for M4 Bonsai 8B and 15/15 for M5 Qwen3.8 27B MLX |
| Small-model routing | [Development-selected family policy](results/two-mac-development-routing.json) selects Bonsai 8B for all five families; configured fallback remains gated by actual availability, capacity and output validation |
| Held-out routed execution | [Final campaign](results/heldout-two-mac-routed-v2.json): 15/15 references, 7 completed deliverables and 11 correct review/abstention outcomes; these categories overlap |
| Real two-machine concurrency | [Grant-package demonstration](results/two-mac-concurrency-v2.json): both artifact references pass; three successful request pairs overlap for 2,724 ms in total |
| Recovery and fallback | [Final recovery demonstration](results/two-mac-recovery-v2.json): three accepted remote case notes retained without duplicate attempts on resume; deliberately absent remote model falls back to Bonsai successfully |
| Capacity and crash controls | 140 implementation tests pass, including separate-process exclusion, stale/unknown/pressured telemetry rejection, bounded waits, cancellation, persistent quarantine and explicit clearance |
| Resource accounting | Each live report retains per-worker attempts, token counts, timing coverage, admission overhead and resource snapshots; CLI exports include `workers.csv` and `admission.csv` |

The final live reports share source digest `a6ac1ab666907cc507801bf5ecfd3bb5669ceb61439b1af873dee1e0e61a985e`. The first concurrency smoke run crossed a source edit and is excluded from frozen qualification; its actual attempts remain in the local ledger.

The final held-out campaign recorded 158 attempts, 26,791 input tokens, 9,829 output tokens and 150.166 seconds of summed measured request duration. These include failures and repairs. Admission, document processing and queue waits are separate; summed request duration is not end-to-end elapsed time.

## Operating the fleet

Run these from the workflow-manager checkout using its prepared local configuration:

```sh
node bin/wm.js fleet context coordinator
node bin/wm.js fleet context mac48
node scripts/fleet-demo.mjs --task grant_cycle_package-01
node bin/wm.js usage
node bin/wm.js report export RUN_ID
```

The demo starts one local and one remote workflow. Worker leases serialize each machine across cooperating coordinator processes. Fresh native memory pressure and CPU checks run before each inference request. Telemetry does not establish GPU capacity or reserve future memory.

A dead worker-lease owner or uncertain incomplete generation quarantines the worker. Use `wm fleet quarantine mac48` to inspect it. Clear it only after verifying that the runtime has stopped or is idle, with the explicit `--idle-verified` flag. Normal telemetry alone is insufficient.

## Model choice and limits

Bonsai 8B was about 6.56 times faster in summed request duration than the M5 Qwen 27B configuration on the matched development cards. Qwen 27B had no recorded failed model attempts, versus nine for Bonsai, but both reached 15/15 reference agreement. This compares complete configurations on these fixtures, including different engines and transport overhead; it does not establish a general model-quality or speed ranking.

The remote Qwen 7B profile provides a smaller second worker and passed the live concurrency/recovery checks. Qwen 27B remains a qualified experimental fallback for the development fixtures. Its runtime TTL unloaded it after testing; [setup instructions](TWO-MAC-SETUP.md#larger-model-residency) explain loading and rechecking capacity before use. Model parameter count alone never grants acceptance.

All benchmark records are synthetic and unreviewed. Stewardship held-out inputs duplicate development inputs, so those checks measure repeatability. Energy, hardware amortization, human time saved and dollar operating cost remain unmeasured. Development subscription accounting is separately recorded in [development.jsonl](build/development.jsonl); the account usage window includes other activity.

The Dell GB10 awaits onboarding. [NVIDIA PAIR](PAIR-INTEGRATION.md) is a researched transport option, not an installed component of this demonstration. The verified implementation uses SSH and does not pool machine memory. Historical-data pilots and independent expert review remain necessary before production or savings claims.
