# Two-Mac setup and qualification

Status as of 2026-09-06: authenticated access, worker inventory, structured probes, and real development workflows are verified on both physical machines. The coordinator is an M4 Pro with 24 GB; worker `mac48` is an M5 Pro with 48 GB. The M5 serves the installed Qwen3.8 27B MLX 4-bit artifact through LM Studio. The final held-out routing campaign passed 45/45 synthetic reference checks across three repetitions. Concurrent inference and graceful checkpoint recovery passed on the same source version; see [two-Mac results](TWO-MAC-RESULTS.md).

## Development evidence

The fixed development campaigns cover three synthetic cards per workflow, across all five workflows. See the [comparison report](results/two-mac-development-comparison.md) and its [machine-readable accounting](results/two-mac-development-comparison.json).

| Measured result | M4 Bonsai 8B over loopback | M5 Qwen3.8 27B MLX over SSH |
| --- | ---: | ---: |
| Reference passes / runs | 15 / 15 | 15 / 15 |
| Completed deliverables | 7 | 7 |
| Correct review or abstention | 11 | 11 |
| Model attempts, including repairs | 154 | 149 |
| Failed attempts retained | 9 | 0 |
| Input tokens | 26,791 | 26,091 |
| Output tokens | 9,826 | 8,528 |
| Sum of measured attempt durations | 134.259 seconds | 881.242 seconds |

Completion and review counts overlap: a complete review packet can still require a human decision. They must not be added. A reference pass includes correct refusal or exception behavior and does not mean a completed application. Both campaigns have token counts for every retained attempt; unavailable metrics elsewhere remain unknown.

These measurements support keeping the small worker as the development default for these cards. The larger worker avoided recorded model-attempt failures but took more summed request time. This is a comparison of complete configurations, including different engines and SSH overhead, not an isolated model-speed test, end-to-end latency measurement, or proof the larger model is unnecessary. Subsequent lease and admission changes require fresh verification. References are synthetic and unreviewed; stewardship held-out inputs duplicate development inputs and establish repeatability only.

## Authenticated transport and configuration

Enable Remote Login on the worker. Keep model servers bound to loopback and use authenticated SSH for administration and the SSH stdio relay for inference. Initial onboarding can pin an unseen key with OpenSSH `accept-new`; changed keys are rejected. Runtime connections require an already trusted host key, key-based authentication, and strict checking.

Read-only inventory can be streamed through an administratively configured SSH alias:

```sh
ssh WORKER 'python3 -' < tools/worker_inventory.py
```

The application adapter itself takes an explicit private IPv4 address and account, not SSH aliases or custom proxy configuration. In ignored `wm.config.json`, replace the example address/account with observed values:

```json
{
  "admission": {"enabled": true, "maxWaitMs": 30000, "maxCpuPercent": 85},
  "workers": {
    "mac48": {"host": "192.168.1.20", "user": "worker", "telemetryPort": 3000}
  },
  "providers": {
    "mac48-qwen27-mlx": {
      "kind": "local", "adapter": "lmstudio", "workerId": "mac48",
      "baseUrl": "http://127.0.0.1:1234", "model": "wm-qwen38-27b-mlx",
      "context": 4096, "maxTokens": 1024,
      "reasoningEffort": "none", "enabled": true
    }
  }
}
```

The model ID is the loaded LM Studio alias observed in this setup; other installations must use their observed ID. Physical model files were inventoried separately from the alias. A successful probe establishes bounded capability, not permission to bypass workflow gates.

```sh
wm fleet inventory mac48
wm provider test mac48-qwen27-mlx
wm fleet context mac48
```

The relay requires Python 3 on the worker, ignores HTTP proxy environment variables, refuses redirects, bounds responses, and targets allowlisted loopback routes. It opens no LAN inference listener. Keep raw identity/inventory records in ignored `.wm/`; published reports use worker labels rather than addresses or account names.

Each request launches SSH. Request duration and TTFT include connection/relay overhead; engine-reported processing durations remain separate. Worker before/after snapshots can miss an interior peak. RSS is not total model, Metal, compressed-memory, or accelerator allocation. Coordinator measurements never stand in for remote memory. Closing SSH does not prove the backend has stopped computing.

## Verified M5 monitor routes

Six routes were exercised on the worker monitor. Their existence does not make it an inference dispatcher:

| Method | Route | Verified role |
| --- | --- | --- |
| GET | `/.well-known/agent.json` | Monitor manifest and identity |
| GET | `/api/a2a/hello` | Greeting/identity response |
| GET | `/api/context` | Current host context |
| GET | `/api/metrics` | Metrics response |
| GET | `/api/health` | Health response |
| POST | `/api/a2a/messages` | Echo/reply plus context; **does not dispatch work** |

The workflow telemetry reader checks the manifest ID `local.laptop-context-agent`, then fetches `/api/context` over authenticated SSH. It retains only typed, allowlisted metrics. It does not follow monitor prose, planning advice, or message replies as instructions.

The [monitor correction patch](monitor-telemetry-correction.patch) records the native-pressure fix: parse the page size actually reported by `vm_stat` instead of assuming 4096 bytes, and read `kern.memorystatus_vm_pressure_level` separately. Memory occupancy percentage is a working-set estimate, not native pressure. Native levels are 1 normal, 2 warning, and 4 critical; unavailable readings remain unknown. This distinction matters on Apple Silicon with 16 KB pages.

Admission is opt-in through `config.admission.enabled === true`. The helper screens freshness, CPU utilization, and native pressure. Defaults require telemetry no older than 15 seconds, CPU at or below 85%, and native pressure level 1; missing, invalid, stale, warning, or critical evidence denies admission. It does not measure GPU capacity or reserve resources. With admission disabled, `wm fleet context` is informational and does not guard workflow dispatch.

The runner checks admission **inside the worker lease, before a model request starts**. It waits within `maxWaitMs` (default 30000, maximum 300000), polling at `pollMs` (default 1000, maximum 60000); `maxAgeMs` defaults to 15000 with maximum 60000. `maxCpuPercent` is configurable from 0 to 100; `maxMemoryPressureLevel` defaults to 1 and cannot make warning/critical pressure admissible. A capacity timeout records the reason and tries a configured alternative on a different worker. It does not count as a model repair or repeatedly wait on the same denied host for that step. No healthy eligible worker yields a blocked run; cancellation remains cancellation; invalid policy is an error. Admission check/wait events are separate from inference tokens and timing. The full implementation and reporting suite passes 144 tests, including admission, worker quarantine, separate-process leases and recovery. Live fleet verification is recorded separately below.

## Coordinator-local worker leases

The former single global workflow lock has been replaced with SQLite run and worker leases in `coordinator-leases.sqlite`, under the shared local state directory. The run lease protects a run from duplicate ownership. The worker lease serializes inference to that worker across cooperating processes on this coordinator, including provider probes. Different worker IDs can proceed independently.

Ownership uses local PIDs and release tokens. A live owner is not displaced by a timeout; cancellation and wait deadlines stop waiting. Dead run owners can be reclaimed atomically. A dead worker-lease owner instead creates a persistent quarantine: the remote backend may still be computing. An incomplete model stream also quarantines its worker when backend idleness is uncertain. A reused PID remains conservatively live. The lease remains held through request settlement, and release cannot delete a replacement owner's lease.

This is **not distributed coordination across multiple coordinator hosts**. Every cooperating process must use the same local state database. It cannot reserve capacity against unrelated applications or prove a remote inference stopped after an owner died. Multi-process mocked-provider tests exercise same-worker exclusion and different-worker overlap; real simultaneous two-Mac inference and worker-loss recovery must still be verified.

## Remaining qualification

1. Finish runner admission wiring and verify denial produces no model dispatch, records its reason, and releases leases correctly.
2. Exercise real parallel jobs on the two different workers and conflicting jobs targeting the same worker.
3. Verify worker loss, transport cancellation, owner death, and resume without duplicate accepted work or invented token totals.
4. Freeze application source, profiles, and routing after these changes, then run the held-out repetitions across all five workflows.
5. Promote routing only from comparable evidence. Keep correct human-review outcomes separate from completed deliverables.

The GB10 remains unqualified until prepared and tested. None of these mechanisms pools either Mac's memory with the GB10 or invokes Astra as an application runtime.

## Worker quarantine and explicit clearance

A worker quarantine survives coordinator restart and lease release. Normal CPU or memory pressure does not clear it. The coordinator can try another configured worker; it does not dispatch another request to the quarantined worker. To inspect:

```sh
wm fleet quarantine mac48
```

After checking the relevant runtime and verifying it has stopped or is idle, an operator can explicitly attest that verification:

```sh
wm fleet clear-quarantine mac48 --idle-verified
```

The command refuses clearance while a cooperating process owns a live worker lease. Its result records an operator attestation, not independent backend-idleness proof. Do not use it merely because the monitor reports normal memory pressure.

## Live recovery evidence

The [first fleet held-out campaign](results/heldout-two-mac-routed-v1.json) passed 15/15 references with the development-selected Bonsai default. It retained 158 attempts, 26,791 input tokens and 9,829 output tokens, including repairs. This is a routed-system test, not a second independent model benchmark.

The [recovery demonstration](results/two-mac-recovery-v1.json) cancelled the remote Qwen 7B case-note workflow after three settled, accepted requests, then resumed all 40 notes. The three original attempt IDs were preserved without duplicate requests. A deliberately absent remote model subsequently fell back to Bonsai and passed the participation reference. This establishes graceful checkpoint recovery and unavailable-model fallback; it does not simulate a backend process crash. Both reports retain their exact source digests from before the subsequent quarantine hardening.

The final [held-out campaign](results/heldout-two-mac-routed-v2.json), [concurrency run](results/two-mac-concurrency-v2.json), and [recovery run](results/two-mac-recovery-v2.json) all use source digest `a6ac1ab666907cc507801bf5ecfd3bb5669ceb61439b1af873dee1e0e61a985e`, including quarantine protection. The final routed campaign passed 15/15 references; the concurrent grant runs both passed with 2,724 ms of successful request overlap. This is request concurrency evidence, not a GPU utilization measurement.

### Larger-model residency

Qwen 27B was unloaded by the runtime TTL after qualification. The configured alias must be loaded before it can serve as a fallback; the application does not silently allocate that model. On the worker, the observed load command was:

```sh
lms load qwen/qwen3.8-27b --context-length 4096 --parallel 1 --identifier wm-qwen38-27b-mlx --ttl 600 --yes
```

The runtime reported a loaded context of 119552 despite the requested 4096. The application retained its conservative 4096 input budget. Recheck native memory pressure after loading and run the accounted provider probe before relying on the alias. The first default-reasoning probe produced no usable JSON; the qualified profile uses `reasoningEffort: "none"`. A successful capacity check before loading does not guarantee sufficient headroom afterward.

The extended [final repeatability report](results/two-mac-repeatability-final.json) records routed 45/45 and fixed Qwen 27B 43/45 first-pass references across three repetitions each. The two Qwen failures were telemetry deferrals and were recovered separately without rewriting their original campaign results. The test-loaded large alias was unloaded after qualification to return memory to the M5.
