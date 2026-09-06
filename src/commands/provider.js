import { listProviderNames, testProvider } from "../providers/index.js";
import { resolveApiKey } from "../config.js";

export async function cmdProviderList(config) {
  for (const name of listProviderNames(config)) {
    const p = config.providers[name];
    const status =
      p.kind === "cloud"
        ? resolveApiKey(p)
          ? "key set"
          : `missing ${p.apiKeyEnv}`
        : `local @ ${p.baseUrl}`;
    console.log(`${name}\t${p.kind}\t${p.model}\t${status}`);
  }
}

export async function cmdProviderTest(config, name) {
  if (!name) throw new Error("usage: wm provider test <name>");
  console.log(`sending smoke prompt to ${name}...`);
  const reply = await testProvider(config, name);
  console.log(`response: ${reply || "(empty)"}`);
}
