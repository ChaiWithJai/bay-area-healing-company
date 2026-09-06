import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const SAMPLE_CONFIG = {
  defaultProvider: "anthropic",
  providers: {
    anthropic: { model: "claude-sonnet-5" },
    ollama: { model: "llama3.1", baseUrl: "http://127.0.0.1:11434" }
  },
  workflowsDir: "./workflows",
  outputDir: "./output"
};

export async function cmdInit() {
  const configPath = "wm.config.json";
  if (existsSync(configPath)) {
    console.log(`${configPath} already exists, leaving it alone.`);
  } else {
    await writeFile(configPath, `${JSON.stringify(SAMPLE_CONFIG, null, 2)}\n`, "utf8");
    console.log(`wrote ${configPath}`);
  }

  await mkdir("inputs", { recursive: true });
  await mkdir("output", { recursive: true });
  console.log("created inputs/ and output/");
  console.log("");
  console.log("Next steps:");
  console.log("  1. export ANTHROPIC_API_KEY=... (or run `ollama serve` for a local model)");
  console.log("  2. wm workflow list");
  console.log("  3. put source files in inputs/<workflow-id>/ and run: wm workflow run <workflow-id>");
}
