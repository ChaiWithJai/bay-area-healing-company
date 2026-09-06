# Architecture

`wm` is a small, dependency-free Node CLI that runs **workflows** — ALE-style
task cards with declared inputs, a required deliverable set, binary gates,
and a continuous score — against a pluggable AI **provider** (cloud or
local). It borrows the shape of HashiCorp Waypoint (a cascading config file,
a provider/plugin boundary, `init` → `run` verbs) without any of Waypoint's
code, infra-deploy focus, or license.

## The black-box contract

```
                    ┌─────────────────────────────────────────────┐
                    │            BLACK BOX (workflow)              │
   INFLOW ─────────▶│  no assertions about internals.              │──────▶ DELIVERABLE
   raw records,     │  human, agent, or hybrid — irrelevant        │        artifact
   funder rules     │  to the contract.                            │        + evidence trace
                    └─────────────────────────────────────────────┘
                              │                        │
                              ▼                        ▼
                    ┌──────────────────┐    ┌─────────────────────┐
                    │  GATE (binary)   │    │  SCORE (continuous) │
                    │  written first.  │───▶│  only runs if gate  │
                    │  fail ⇒ 0, hard  │    │  passed             │
                    └──────────────────┘    └─────────────────────┘
```

A workflow spec (`workflows/*.json`) is the test written before the
implementation: `deliverable` names the files that must exist, `gates` are
binary pass/fail checks on those files, and `score` is a continuous rubric
that only runs once every gate passes. `wm workflow run` treats whatever
produces the deliverable — a cloud model, a local model, a script, a human
editing files by hand — as an interchangeable black box. That's the point:
the CLI never knows or cares what's inside the box, only whether the
contract was met.

`src/engine/gates.js` implements the generic, structural half of that
contract (deliverables exist, aren't empty). The domain-specific gates
listed in each spec ("every RFP requirement id appears exactly once",
"no unrestricted-fund line charged to a restricted category") are
intentionally **not** auto-implemented — encoding them is the actual
organizational work described below, and a generic implementation would be
exactly the failure mode this project is trying to avoid: a gate that
passes on day one and therefore measures nothing.

## Why gates decay (Meadows)

A system that isn't fed corrective information drifts toward its
lowest-energy state — for an accountability workflow, that state is "the
report gets written but the numbers stop meaning anything." Modeling this
with stocks and flows:

- **Stock:** `schema_fidelity` — the fraction of live records conforming to
  the target schema. Everything else (evidence traceability, funder trust)
  is derived from this one stock.
- **Entropy sources (outflow):** funder rule changes, staff turnover
  carrying tacit schema knowledge, new intake formats added without a
  schema update, tool migrations.
- **B1 (balancing loop):** gate failure → root cause → schema/rule-encoding
  update → fidelity restored. This is the whole mechanism. If gate failures
  are silently overridden or ignored, B1 is severed.
- **R1 (reinforcing, slow):** traceable numbers → funder confidence →
  larger restricted awards → more schema investment → better numbers. Lags
  `schema_fidelity` by one to two grant cycles — expect no early payoff.
- **R2 (reinforcing, decay):** unnoticed drift → reports still ship →
  nobody complains → less schema attention → more drift. This is the
  default outcome whenever B1 is severed; it is not a separate risk.

Leverage points, weakest to strongest (Meadows' ordering): tuning
thresholds and tolerances is the weakest lever; buffer size (how much drift
is tolerated before intervention) is slightly better; shortening the
gate-to-correction delay is real, mechanically achievable leverage; fixing
information flow (making a gate failure visible to whoever can actually
change the schema, not just whoever ran the workflow) is where most
organizations break; restricting who is allowed to add a new intake format
is the single highest-leverage change and costs nothing; and the strongest
lever of all is the goal itself — reframing the workflow's purpose from
"produce the report" to "maintain a trustworthy stock of records the
report is derived from." Nothing above that survives without the reframe.

## TDD contract per workflow

- **Red:** write the gate against real historical data before building
  anything. It must fail on current-state records — if it passes on day
  one, it isn't measuring anything.
- **Green:** the minimum intervention that passes the gate. Often a schema
  decision and a checklist, not software.
- **Refactor:** only after green — automate. Automating before green
  encodes the drift.
- **Regression:** every rule change becomes a new gate/test case, appended,
  never a rewrite. The suite becomes encoded institutional memory that
  survives staff turnover, the primary entropy source.

Report accuracy at time `t` is a function of the gate-to-correction delay,
not of how capable the underlying model is — which lines up with the
finding that most agent task failures are in Understanding/Approach, not
execution. Capability isn't the binding constraint; the encoded rule set
is.

## The fifth workflow: stewardship structuring

The four "operating" workflows (`grant_cycle_package`,
`case_note_normalization`, `board_report_synthesis`,
`volunteer_hours_reconciliation`) all assume an entity that can legally
receive restricted, tax-deductible money. `stewardship_structuring` is what
creates that entity — the Hashimoto/Ghostty pattern of fiscal sponsorship
over a standalone 501(c)(3): immediate tax-deductible donations and
compliance support for an admin fee, instead of a months-to-years IRS
determination, in exchange for accepting a sponsor's oversight. It's
sequenced first for any project without an existing structure, because it
gates the other four rather than sitting beside them.

## Repository layout

```
bin/wm.js              CLI entrypoint
src/cli.js              argument parsing + command dispatch
src/config.js            cascading config loader
src/providers/          cloud + local AI adapters, one shared complete() contract
src/workflows/          workflow spec loader/registry
src/engine/              runner (inflow -> provider -> files) + gate checks
src/commands/            one file per command group
workflows/*.json         bundled workflow specs (the five above)
test/                    node:test smoke tests
```

## Extending

- **New workflow:** drop a JSON file matching the shape in `workflows/` (or
  point `workflowsDir` in `wm.config.json` at your own directory).
- **New provider:** add an adapter function in `src/providers/index.js` and
  a `providers.<name>` block in config; the runner and CLI need no changes.
