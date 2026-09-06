import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Set WM_PYTHON to the interpreter reported by Codex load_workspace_dependencies.
const python=process.env.WM_PYTHON||'python3';
const result=spawnSync(python,[fileURLToPath(new URL('./generate.py',import.meta.url))],{stdio:'inherit'});
process.exit(result.status??1);
