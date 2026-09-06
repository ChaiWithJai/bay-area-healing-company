import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { cmdInit } from "./commands/init.js";
import { cmdWorkflowList, cmdWorkflowShow, cmdWorkflowRun } from "./commands/workflow.js";
import { cmdProviderList, cmdProviderTest } from "./commands/provider.js";
import { cmdConfigShow } from "./commands/config.js";

const HELP = `wm — open-source workflow manager (Waypoint-style) for accountability workflows.

Usage:
  wm init                                Scaffold wm.config.json and an inputs/ dir in the current directory
  wm workflow list                       List available workflows
  wm workflow show <id>                  Print a workflow's full spec
  wm workflow run <id> [options]         Run a workflow end to end
      --provider <name>                    Provider to use (default: config defaultProvider)
      --input-dir <path>                   Directory of input files (default: ./inputs/<id>)
      --output-dir <path>                  Directory to write deliverables (default: ./output/<id>)
  wm provider list                       List configured providers (cloud + local)
  wm provider test <name>                Send a one-token smoke prompt to a provider
  wm config show                         Print the resolved config

Config resolution (closest wins): built-in defaults -> ~/.wm/config.json -> ./wm.config.json -> env vars.
Cloud providers need an API key env var (ANTHROPIC_API_KEY, OPENAI_API_KEY).
Local providers (ollama) need \`ollama serve\` running; set OLLAMA_HOST to override the default localhost URL.
`;

export async function main(argv) {
  const { positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false
  });

  const [group, sub, ...rest] = positionals;

  if (!group || group === "help" || group === "--help" || group === "-h") {
    console.log(HELP);
    return;
  }

  const config = await loadConfig();

  switch (group) {
    case "init":
      return cmdInit();
    case "workflow": {
      if (sub === "list") return cmdWorkflowList(config);
      if (sub === "show") return cmdWorkflowShow(config, rest[0]);
      if (sub === "run") return cmdWorkflowRun(config, rest, argv);
      break;
    }
    case "provider": {
      if (sub === "list") return cmdProviderList(config);
      if (sub === "test") return cmdProviderTest(config, rest[0]);
      break;
    }
    case "config": {
      if (sub === "show") return cmdConfigShow(config);
      break;
    }
  }

  console.log(HELP);
  throw new Error(`unrecognized command: ${[group, sub].filter(Boolean).join(" ")}`);
}
