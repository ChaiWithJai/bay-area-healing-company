# wm — workflow manager

An open-source, command-line workflow manager for accountability workflows
(grant cycles, case notes, board reporting, volunteer-hours reconciliation,
and the entity-structuring work that makes the other four fundable). Shaped
like HashiCorp Waypoint — cascading config, a provider/plugin boundary,
`init` → `run` verbs — but standalone, MIT licensed, and built for a
different job: running black-box workflows against whichever AI provider
you plug in, cloud or local, and gating the result before you trust it.

No runtime dependencies. Node 18+ only.

## Install

```sh
npm install -g .        # from a clone, or `npm link` for local dev
wm help
```

## Quick start

```sh
wm init                       # scaffolds wm.config.json, inputs/, output/
wm workflow list               # the five bundled workflows
wm provider list                # see which providers are configured / have keys

# Cloud:
export ANTHROPIC_API_KEY=sk-...
wm provider test anthropic

# Local (no API key, no data leaves your machine):
ollama serve &
ollama pull llama3.1
wm provider test ollama

# Put source files for a workflow under inputs/<short-id>/, then:
wm workflow run stewardship_structuring --provider ollama
wm workflow run grant_cycle_package --provider anthropic
```

Each run writes deliverables under `output/<short-id>/`, logs the full raw
model output alongside them for audit, and prints which structural gates
passed. See `docs/ARCHITECTURE.md` for what a "gate" means here and why the
domain-specific gates in each spec are left for you to encode rather than
auto-implemented.

## Configuration

`wm.config.json` in your project (or `~/.wm/config.json` for machine-wide
defaults) overrides the built-in defaults; closest file wins, environment
variables win over both:

```json
{
  "defaultProvider": "ollama",
  "providers": {
    "anthropic": { "model": "claude-sonnet-5" },
    "openai": { "model": "gpt-4o-mini" },
    "ollama": { "model": "llama3.1", "baseUrl": "http://127.0.0.1:11434" }
  },
  "workflowsDir": "./workflows",
  "outputDir": "./output"
}
```

| Env var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | enables the `anthropic` provider |
| `OPENAI_API_KEY` | enables the `openai` provider |
| `OLLAMA_HOST` | overrides the local `ollama` base URL |
| `WM_DEFAULT_PROVIDER` | overrides `defaultProvider` |

## The five workflows

| id | what it does |
|---|---|
| `nonprofit/grant_cycle_package` | RFP + 990 + budget + prior report → application package + compliance crosswalk |
| `nonprofit/case_note_normalization` | free-text intake notes → normalized records + exceptions needing human review |
| `nonprofit/board_report_synthesis` | quarterly metrics + financials → board packet, variance table, risk-register diff |
| `nonprofit/volunteer_hours_reconciliation` | sign-ins + scheduler export + self-reported hours → reconciled ledger + funder rollup |
| `nonprofit/stewardship_structuring` | assets + contributors + funding intent → fiscal-sponsorship-vs-501(c)(3) memo, IP transfer inventory, fund-use policy, governance matrix |

`stewardship_structuring` is the fifth workflow — the Hashimoto/Ghostty
pattern of converting a project into an entity that can legally receive
restricted, tax-deductible money. It's the one that unlocks the other four;
see `docs/ARCHITECTURE.md` for why it's sequenced first when no entity
exists yet.

`wm workflow show <id>` prints the full spec (inputs, deliverables, gates,
scoring rubric, and the ALE-derived rationale for why agents tend to fail
each one today).

## Extending

Add a workflow by dropping a JSON spec into `workflows/` (or point
`workflowsDir` at your own directory). Add a provider by adding an adapter
function in `src/providers/index.js` — the CLI and runner need no changes
either way. Full details in `docs/ARCHITECTURE.md`.

## License

MIT.
