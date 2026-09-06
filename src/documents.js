import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../tools/documents.py', import.meta.url));

function invoke(request, config) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.python || process.env.WM_PYTHON || 'python3', [script], {
      stdio: ['pipe', 'pipe', 'pipe'], signal: config.signal,
    });
    const output = [];
    const errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => {
      try {
        const result = JSON.parse(Buffer.concat(output).toString('utf8'));
        if (code !== 0 || result.error) throw new Error(result.error || Buffer.concat(errors).toString('utf8'));
        resolve(result);
      } catch (error) {
        reject(new Error(`Document ${request.operation} failed: ${error.message}${output.length ? '' : ` ${Buffer.concat(errors).toString('utf8')}`}`));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export function readSources(inputDir, config = {}) {
  return invoke({ operation: 'read', directory: inputDir }, config);
}

export function renderArtifacts(outputDir, artifacts, config = {}) {
  return invoke({ operation: 'render', directory: outputDir, artifacts }, config);
}
