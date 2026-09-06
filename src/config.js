import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CONFIG = {
  version: 2, workers: {}, defaultProvider: 'bonsai8',
  providers: {
    bonsai8: { kind: 'local', adapter: 'ollama', model: 'bonsai-8b:latest', baseUrl: 'http://127.0.0.1:11434', context: 4096, maxTokens: 1024, enabled: true },
    qwen7: { kind: 'local', adapter: 'ollama', model: 'qwen2.5:7b', baseUrl: 'http://127.0.0.1:11434', context: 4096, maxTokens: 1024, enabled: true },
    bonsai27: { kind: 'local', adapter: 'lmstudio', model: 'ternary-bonsai-27b-mlx', baseUrl: 'http://127.0.0.1:1234', context: 4096, maxTokens: 1024, enabled: false }
  },
  routing: { alternatives: ['qwen7'], families: {}, maxRepairs: 1 },
  limits: { requestTimeoutMs: 90000, runTimeoutMs: 900000, maxAttempts: 160, maxPromptChars: 11000, maxOutputBytes: 1000000 },
  stateDir: './.wm', outputDir: './output', workflowsDir: path.join(ROOT, 'workflows'), python: 'python3',
  policy: { localOnly: true, cloudEnabled: false }
};
function merge(a, b) {
  const out = structuredClone(a);
  for (const [key, value] of Object.entries(b ?? {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe configuration key');
    out[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(out[key] ?? {}, value) : value;
  }
  return out;
}
async function json(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`Invalid config ${file}: ${e.message}`); }
}
export async function loadConfig(cwd = process.cwd()) {
  let c = merge(DEFAULT_CONFIG, await json(path.join(os.homedir(), '.wm', 'config.json')));
  c = merge(c, await json(path.join(cwd, 'wm.config.json')));
  if (process.env.WM_DEFAULT_PROVIDER) c.defaultProvider = process.env.WM_DEFAULT_PROVIDER;
  if (process.env.WM_PYTHON) c.python = process.env.WM_PYTHON;
  if (process.env.WM_STATE_DIR) c.stateDir = process.env.WM_STATE_DIR;
  if (process.env.OLLAMA_HOST) for (const p of Object.values(c.providers)) if (p.adapter === 'ollama') p.baseUrl = process.env.OLLAMA_HOST;
  if (c.policy?.localOnly !== true || c.policy?.cloudEnabled !== false) throw new Error('Cloud execution cannot be enabled in this local-only application');
  for (const key of ['stateDir', 'outputDir', 'workflowsDir']) c[key] = path.resolve(cwd, c[key]);
  for (const key of Object.keys(DEFAULT_CONFIG.limits)) if (!Number.isFinite(c.limits[key]) || c.limits[key] <= 0) throw new Error(`Invalid limit: ${key}`);
  if (!Number.isInteger(c.routing.maxRepairs) || c.routing.maxRepairs < 0 || c.routing.maxRepairs > 1) throw new Error('maxRepairs must be 0 or 1');
  return c;
}
