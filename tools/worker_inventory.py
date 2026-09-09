#!/usr/bin/env python3
"""Read-only fleet preflight. Run locally or stream over an authenticated SSH session.

Uses only Python's standard library. Never generates text, downloads models,
reads credentials, or exposes an inference listener to the LAN.
"""
import datetime
import json
import platform
import shutil
import subprocess
import urllib.request


def command(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=3,
                              check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def local_json(port, route):
    # Fixed loopback endpoints only; ignore proxy environment variables.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(f'http://127.0.0.1:{port}{route}', timeout=3) as response:
        content = response.read(1024 * 1024 + 1)
        if len(content) > 1024 * 1024:
            raise ValueError('Inventory response exceeds limit')
        return json.loads(content)


def inventory():
    mac = platform.system() == 'Darwin'
    memory = command(['/usr/sbin/sysctl', '-n', 'hw.memsize']) if mac else None
    result = {
        'schemaVersion': 1,
        'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'evidence': 'observed',
        'hardware': {
            'platform': platform.system(), 'release': platform.release(),
            'architecture': platform.machine(),
            'model': command(['/usr/sbin/sysctl', '-n', 'hw.model']) if mac else None,
            'chip': command(['/usr/sbin/sysctl', '-n', 'machdep.cpu.brand_string']) if mac else None,
            'physicalMemoryBytes': int(memory) if memory and memory.isdigit() else None,
        },
        'tools': {name: shutil.which(name) is not None for name in ['node', 'python3', 'ollama', 'git']},
        'hostSwap': command(['/usr/sbin/sysctl', '-n', 'vm.swapusage']) if mac else None,
        'hostMemoryPressureLevel': command(['/usr/sbin/sysctl', '-n', 'kern.memorystatus_vm_pressure_level']) if mac else None,
        'runtimes': [],
        'limitations': ['No inference qualification performed', 'No energy or accelerator allocation measured',
                        'Runtime model metadata is advertised, not independently verified'],
    }
    for adapter, port, route in [('ollama', 11434, '/api/tags'), ('lmstudio', 1234, '/v1/models')]:
        runtime = {'adapter': adapter, 'reachable': False, 'models': None, 'version': None}
        try:
            data = local_json(port, route)
            runtime['reachable'] = True
            if adapter == 'ollama':
                runtime['models'] = [{k: m.get(k) for k in ['name', 'digest', 'size', 'details', 'remote_host', 'remote_model']}
                                     for m in data.get('models', [])]
                try:
                    runtime['version'] = local_json(port, '/api/version').get('version')
                except Exception:
                    pass
            else:
                runtime['models'] = [{'id': m.get('id')} for m in data.get('data', [])]
        except Exception as error:
            runtime['errorType'] = type(error).__name__
        result['runtimes'].append(runtime)
    return result


if __name__ == '__main__':
    print(json.dumps(inventory(), indent=2))
