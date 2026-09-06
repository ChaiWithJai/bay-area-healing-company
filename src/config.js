import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_CONFIG = {
  // Which provider `wm workflow run` uses when --provider isn't passed.
  defaultProvider: "anthropic",
  providers: {
    anthropic: {
      kind: "cloud",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      baseUrl: "https://api.anthropic.com/v1/messages",
      model: "claude-sonnet-5"
    },
    openai: {
      kind: "cloud",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini"
    },
    ollama: {
      kind: "local",
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.1"
    }
  },
  workflowsDir: "./workflows",
  outputDir: "./output"
};

const CONFIG_FILENAMES = ["wm.config.json", ".wmrc.json"];

function deepMerge(base, override) {
  if (!override) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object"
    ) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function loadJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`could not parse config at ${filePath}: ${err.message}`);
  }
}

/**
 * Cascading config, closest wins: built-in defaults -> ~/.wm/config.json ->
 * ./wm.config.json (or .wmrc.json) -> environment variables.
 */
export async function loadConfig(cwd = process.cwd()) {
  let config = DEFAULT_CONFIG;

  const homeConfig = await loadJsonIfExists(
    path.join(os.homedir(), ".wm", "config.json")
  );
  config = deepMerge(config, homeConfig);

  for (const name of CONFIG_FILENAMES) {
    const projectConfig = await loadJsonIfExists(path.join(cwd, name));
    if (projectConfig) {
      config = deepMerge(config, projectConfig);
      break;
    }
  }

  if (process.env.WM_DEFAULT_PROVIDER) {
    config.defaultProvider = process.env.WM_DEFAULT_PROVIDER;
  }
  if (process.env.OLLAMA_HOST) {
    config.providers.ollama.baseUrl = process.env.OLLAMA_HOST;
  }

  return config;
}

export function resolveApiKey(providerConfig) {
  if (!providerConfig.apiKeyEnv) return null;
  return process.env[providerConfig.apiKeyEnv] || null;
}
