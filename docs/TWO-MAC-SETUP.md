# Two-Mac qualification

The 24GB M4 Pro is the verified coordinator and small-model worker. The second Mac is a candidate worker until authenticated access, hardware inventory, runtime probes and actual workflow runs establish its capabilities. Bonjour discovery alone does not establish ownership, RAM, CPU model or execution access.

Enable Remote Login on the worker and use the account and hostname shown by macOS. Keep model servers bound to loopback. Use authenticated SSH for administration and the SSH stdio relay for inference; do not expose an unauthenticated Ollama or LM Studio listener to the LAN. Initial onboarding may use OpenSSH accept-new to pin a previously unseen key (trust on first use); changed keys remain rejected. For independently verified identity, compare the fingerprint on the worker. Runtime connections require an already trusted key and never auto-accept one.

After establishing SSH access, stream the read-only inventory script to the worker. Replace `WORKER` with its configured SSH alias or user and hostname:

```sh
ssh WORKER 'python3 -' < tools/worker_inventory.py
```

The script uses the Python standard library, reports hardware and local runtime inventory, and performs no inference or installation. It ignores HTTP proxy environment variables, refuses redirects, bounds responses and contacts only fixed loopback endpoints. Missing runtime responses are unavailable, not evidence that no model files exist. Remote noninteractive shells may have a different PATH, so tool availability also requires checking known installation paths when necessary.

The coordinator's preflight can be captured separately:

```sh
python3 tools/worker_inventory.py > .wm/local-worker-preflight.json
```

Keep identifiable discovery records and raw worker inventory in ignored `.wm/`. Published benchmark reports should use stable worker labels and hardware descriptions rather than network addresses or account names.

The implementation and qualification sequence is:

1. Verify authenticated worker identity, chip, physical memory, runtime versions and installed artifact digests.
2. Exercise the SSH stdio relay with failure detection. It contacts the worker’s loopback runtime without exposing a LAN HTTP server. Keep cloud inference disabled.
3. Attach worker identity to provider fingerprints and attempts. Collect worker resources on that worker; coordinator memory is not remote inference memory. Record unknown metrics as null.
4. Extend concurrency through explicit worker leases with cancellation and recovery. Until tested, preserve serial execution.
5. Probe structured output and context constraints before enabling an artifact. Run the existing development cards under a fixed profile; choose routing using those results.
6. Freeze profiles and routing, then run held-out repetitions for all five workflows, recording failures, repairs, escalations and review decisions. Preserve the existing warning that these fixtures are synthetic and stewardship held-out cards repeat development inputs.
7. Exercise worker loss and resumption. Confirm that accepted work is not duplicated, partial usage remains visible and unavailable workers do not produce successful completion claims.

Two-machine completion requires evidence of real inference on both physical machines, trustworthy attribution and verified workflow artifacts. A successful tunnel or a local fake worker is only an intermediate check. The Dell GB10 is a later qualification target when the owner prepares it; its memory is not pooled automatically with either Mac.

## Configuring the worker

After key setup, add a worker and a model profile to ignored `wm.config.json`. Replace the example address, account and artifact with observed values:

```json
{
  "workers": {"mac48": {"host": "192.168.1.20", "user": "worker"}},
  "providers": {
    "mac48-small": {
      "kind": "local", "adapter": "ollama", "workerId": "mac48",
      "baseUrl": "http://127.0.0.1:11434", "model": "installed-model:latest",
      "context": 4096, "maxTokens": 1024, "enabled": true
    }
  }
}
```

`wm fleet inventory mac48` reads hardware and runtime metadata. `wm provider test mac48-small` performs an accounted structured probe. A successful probe permits testing, not automatic promotion into the default routing policy. The relay requires Python 3 on the worker and key-based SSH authentication. This initial adapter supports explicit private IPv4 addresses; DHCP changes require updating the local configuration. It does not use SSH aliases or custom proxy configuration.

Each request launches SSH, so measured request latency and TTFT include connection and relay overhead. Runtime-reported prefill/decode remain separate. Remote resources are before/after snapshots of known inference processes, with null for unavailable measurements; they can miss a peak during inference. Coordinator samples remain separately scoped. A transport cancellation stops the client connection but does not prove that the backend immediately stopped computation. Interrupted usage remains unknown unless the runtime reported counts.

The existing global coordinator lock still serializes workflows. Worker parallelism and durable distributed leases are not implemented by this transport change.
