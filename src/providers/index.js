import { resolveApiKey } from "../config.js";

/**
 * Every provider adapter implements the same black-box contract:
 *   complete({ system, prompt, maxTokens }) -> Promise<string>
 * The workflow engine never knows or cares whether that's a cloud API
 * or a local model on the same box.
 */

async function anthropicComplete(providerConfig, { system, prompt, maxTokens = 4096 }) {
  const apiKey = resolveApiKey(providerConfig);
  if (!apiKey) {
    throw new Error(
      `missing ${providerConfig.apiKeyEnv}. Set it in your environment to use the anthropic provider.`
    );
  }
  const res = await fetch(providerConfig.baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: providerConfig.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) {
    throw new Error(`anthropic request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.content?.map((block) => block.text ?? "").join("") ?? "";
}

async function openaiComplete(providerConfig, { system, prompt, maxTokens = 4096 }) {
  const apiKey = resolveApiKey(providerConfig);
  if (!apiKey) {
    throw new Error(
      `missing ${providerConfig.apiKeyEnv}. Set it in your environment to use the openai provider.`
    );
  }
  const res = await fetch(providerConfig.baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: providerConfig.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!res.ok) {
    throw new Error(`openai request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function ollamaComplete(providerConfig, { system, prompt }) {
  const res = await fetch(`${providerConfig.baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: providerConfig.model,
      prompt: `${system}\n\n${prompt}`,
      stream: false
    })
  });
  if (!res.ok) {
    throw new Error(
      `ollama request failed: ${res.status} ${await res.text()}. Is \`ollama serve\` running and is the model pulled (\`ollama pull ${providerConfig.model}\`)?`
    );
  }
  const data = await res.json();
  return data.response ?? "";
}

const ADAPTERS = {
  anthropic: anthropicComplete,
  openai: openaiComplete,
  ollama: ollamaComplete
};

export function listProviderNames(config) {
  return Object.keys(config.providers);
}

export function getProvider(config, name) {
  const providerConfig = config.providers[name];
  if (!providerConfig) {
    throw new Error(
      `unknown provider "${name}". Configured providers: ${listProviderNames(config).join(", ")}`
    );
  }
  const adapter = ADAPTERS[providerConfig.adapter ?? name];
  if (!adapter) {
    throw new Error(`no adapter registered for provider "${name}"`);
  }
  return {
    name,
    kind: providerConfig.kind,
    model: providerConfig.model,
    async complete(args) {
      return adapter(providerConfig, args);
    }
  };
}

export async function testProvider(config, name) {
  const provider = getProvider(config, name);
  const text = await provider.complete({
    system: "Reply with exactly one word.",
    prompt: "Say OK.",
    maxTokens: 8
  });
  return text.trim();
}
