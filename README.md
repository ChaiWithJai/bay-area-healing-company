# Workflow Manager

A local CLI for turning organizational records into verifiable deliverables. It demonstrates five workflows with installed small models, deterministic document tools, source evidence, and resource accounting.

The intended opportunity is practical: help organizations turn activity into reliable records and defensible decisions, while measuring the cost and limits of doing that work. Codex and Astra help develop and test the software through the developer's subscription. **The application never invokes Codex or a paid/cloud inference service.** This first build works on one laptop; multi-machine routing and PAIR are future work.

## Five workflows

| Workflow | Deliverables |
|---|---|
| Volunteer/participation reconciliation | Reconciled hours ledger, funder totals, conflicts |
| Case note normalization | Structured records for forty notes across three formats, exceptions |
| Board reporting | PDF packet, variance table, risk-register changes |
| Grant cycle management | DOCX narrative, XLSX budget, evidence crosswalk |
| Stewardship structuring | Grounded comparison memo, asset inventory, draft fund-use policy, governance matrix |

All outputs retain source evidence. Missing model work and unsupported gates prevent acceptance. A complete stewardship packet still requires human decisions; it performs no incorporation, asset transfer, or expenditure.

## Setup

Use Node.js 24 or newer, Python 3.12 or newer with `requirements.txt`, and local Tesseract and Poppler for scanned PDFs. An already installed model must be available through Ollama or LM Studio. The app never downloads a model.

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export WM_PYTHON="$PWD/.venv/bin/python"
node bin/wm.js init
node bin/wm.js doctor
```

Within Codex, use its bundled Python interpreter returned by `load_workspace_dependencies` instead of creating a second environment when those libraries are available. Install Tesseract/Poppler using the operating system's package manager if absent. The checked-in raster fixture requires both for OCR.

`wm init` creates `wm.config.json`. Edit profile model names to match locally installed artifacts. The initial profiles are `bonsai8` and `qwen7` through Ollama; the `bonsai27` LM Studio profile starts disabled. These are configuration candidates, not a capability ranking. `doctor` reads model inventory; `doctor --probe` consumes local inference for a tiny structured-output check.

```sh
node bin/wm.js doctor --probe --provider bonsai8
node bin/wm.js provider list
node bin/wm.js task list
node bin/wm.js task run volunteer_hours_reconciliation-01 --provider bonsai8
```

The CLI is also exposed as `wm` when installed through npm. Environment variables are documented in `.env.example`; the application does not automatically load that file. Configuration precedence is defaults, `~/.wm/config.json`, project `wm.config.json`, then supported environment overrides.

## Run and inspect

The `01` tasks are ordinary demonstration fixtures:

```sh
node bin/wm.js task run case_note_normalization-01
node bin/wm.js task run board_report_synthesis-01
node bin/wm.js task run grant_cycle_package-01
node bin/wm.js task run stewardship_structuring-01
```

For your own records, follow the input contracts in [the task catalog](docs/TASK-CATALOG.md):

```sh
node bin/wm.js workflow show nonprofit/grant_cycle_package
node bin/wm.js workflow run nonprofit/grant_cycle_package --input-dir ./inputs/grant
```

Each run prints its ID and artifact directory. Substitute that actual ID below:

```sh
node bin/wm.js run list
node bin/wm.js run status RUN_ID
node bin/wm.js trace RUN_ID
node bin/wm.js usage --run-id RUN_ID
node bin/wm.js report export RUN_ID --output-dir ./reports/example
node bin/wm.js run cancel RUN_ID
node bin/wm.js run resume RUN_ID
```

Runs use isolated artifact generations and SQLite checkpoints. Resume rejects changed inputs or work plans and does not reuse stale output files. A failed workflow exits with code 2; review-required output is reported explicitly. Inspect exception counts and gate details alongside the status.

## Choose smaller models using evidence

Calculations, joins, duplicate detection and document rendering run in code. Models extract or select bounded evidence. The router uses configured task-family profiles, permits one targeted repair, then can try a configured alternative local profile. One coordinator inference slot prevents overlapping requests from this application. Larger models are eligible only when explicitly configured and enabled.

Use fixed-profile examinations to compare installed models. Evaluations disable fallback so a larger alternative cannot quietly receive credit for a smaller profile's result:

```sh
node bin/wm.js eval run --provider bonsai8 --split development --task volunteer_hours_reconciliation --repetitions 1 --max-runs 1
node bin/wm.js eval resume CAMPAIGN_ID --max-runs 2
node bin/wm.js eval report CAMPAIGN_ID
node bin/wm.js eval run --provider qwen7 --split heldout --repetitions 3 --max-runs 1
node bin/wm.js eval run --provider routed --split heldout --repetitions 3 --max-runs 1
```

Compare completed development campaigns with `node scripts/routing-report.mjs CAMPAIGN_A CAMPAIGN_B`. The report proposes the fastest fully timed profile that passes all three scenario types, and leaves unsupported families for review. It rejects held-out selection and mismatched code/configuration/rubric versions, and never applies configuration changes.

Campaigns retain exact task/profile/repetition slots and finish in bounded batches. Configuration, source-code and catalog changes require a new campaign. Finished failed attempts remain in the result. References load only after the run terminates; they are never included in execution inputs. Use `--provider routed` to measure the configured family routing and fallback policy as a complete system. Only promote routing changes using development evidence, then evaluate separately on held-out tasks.

## Evidence and limits

The thirty scenarios are **synthetic and `generated_unreviewed`**. Their design follows [Agents' Last Exam's](https://agents-last-exam.org/docs/ale/index.html) focus on deliverables, independent references and execution traces, but they are not official ALE tasks or expert qualification results. Held-out cases are close perturbations. They do not establish production reliability or performance on unfamiliar organizations.

The supported schemas are deliberately bounded. RFP requirements need explicit IDs. Financial and hours tables need documented columns. Case PII validation covers defined fields and patterns, not every possible identifier. Stewardship relies on supplied dated assumptions, not live legal research. Unsupported formats, schemas and policy values must be handled as exceptions or blocked work rather than guessed away.

[Accounting documentation](docs/ACCOUNTING.md) explains tokens, timings, sampled resources, failed attempts, and missing measurements. Public exports exclude raw case content by default. Local traces still contain inputs and model responses. Development subscription consumption and application operating consumption remain separate. Electricity, hardware, labor and savings require additional measurement; no ROI or production-readiness claim follows from these demos.

```sh
npm test
```

Tests use controlled model responses and real document/OCR tooling. They verify implementation behavior without a paid service or running model. Actual model execution is a separate experiment. See [architecture](docs/ARCHITECTURE.md) and [task catalog](docs/TASK-CATALOG.md) for the contracts and limitations.

## Local fleet

The 48GB M5 Pro now serves local models through an authenticated SSH relay. HTTP inference stays on each worker’s loopback interface. See the [two-Mac setup](docs/TWO-MAC-SETUP.md) for worker leases, opt-in capacity admission and measured Qwen3.8 27B results. `wm fleet context mac48` reads the worker’s telemetry without running inference. The GB10 awaits hardware onboarding; [PAIR integration](docs/PAIR-INTEGRATION.md) remains a separate qualification step.

## Measured demonstration

See the [five actual local demo packets](examples/README.md), [laptop measurements](docs/BENCHMARK.md), and [market experiment plan](docs/MARKET-EXPERIMENT.md). The demonstration uses explicitly synthetic data.
