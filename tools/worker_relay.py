"""One bounded HTTP request to a worker's loopback runtime over SSH stdio."""
import base64
import json
import os
import platform
import re
import signal
import subprocess
import sys
import urllib.request


def emit(value):
    print(json.dumps(value), flush=True)


def cmd(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=2, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def resources():
    result = dict(serverRssBytes=None, serverCpuPercent=None, hostSwapUsedBytes=None,
                  hostMemoryPressure=None, acceleratorAllocationMeasured=False)
    raw = cmd(['/bin/ps', '-axo', 'pid=,ppid=,rss=,pcpu=,comm='])
    if raw is not None:
        rows = []
        for line in raw.splitlines():
            m = re.match(r'\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+?)\s*$', line)
            if m:
                rows.append((int(m[1]), int(m[2]), int(m[3])*1024, float(m[4]), os.path.basename(m[5]), m[5].endswith('/.lmstudio/.internal/utils/node')))
        root = re.compile(r'^(ollama(?:_llama_server)?|llmster|llama-server|LM Studio(?: Helper(?: \([\w ]+\))?)?)$', re.I)
        selected = {r[0] for r in rows if r[5] or root.match(r[4])}
        while True:
            expanded = selected | {r[0] for r in rows if r[1] in selected}
            if selected == expanded:
                break
            selected = expanded
        result['serverRssBytes'] = sum(r[2] for r in rows if r[0] in selected)
        result['serverCpuPercent'] = sum(r[3] for r in rows if r[0] in selected)
    if platform.system() == 'Darwin':
        swap = cmd(['/usr/sbin/sysctl', '-n', 'vm.swapusage']) or ''
        m = re.search(r'used\s*=\s*([\d.]+)([MGK])', swap)
        if m:
            result['hostSwapUsedBytes'] = float(m[1])*{'K':1024, 'M':1024**2, 'G':1024**3}[m[2]]
        level = cmd(['/usr/sbin/sysctl', '-n', 'kern.memorystatus_vm_pressure_level'])
        if level in ['1', '2', '4']:
            result['hostMemoryPressure'] = {'level': int(level), 'label': {'1':'normal', '2':'warning', '4':'critical'}[level]}
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def main():
    raw = sys.stdin.buffer.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError('Request size limit')
    request = json.loads(raw)
    port, route, method = request['port'], request['path'], request['method']
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError('Invalid port')
    allowed = {'/api/tags':'GET', '/api/show':'POST', '/api/version':'GET',
               '/api/chat':'POST', '/api/v1/models':'GET', '/v1/models':'GET', '/v1/chat/completions':'POST'}
    if allowed.get(route) != method:
        raise ValueError('Unsupported runtime operation')
    timeout = request['timeoutSeconds']
    if not isinstance(timeout, (int,float)) or not 1 <= timeout <= 900:
        raise ValueError('Invalid timeout')
    def deadline(_signal, _frame):
        raise TimeoutError('Worker request wall deadline exceeded')
    signal.signal(signal.SIGALRM, deadline)
    signal.setitimer(signal.ITIMER_REAL, timeout)
    before = resources() if request.get('sampleResources') else None
    body = request.get('body')
    req = urllib.request.Request(f'http://127.0.0.1:{port}{route}',
                                 data=body.encode() if body is not None else None,
                                 headers={'Content-Type':'application/json'}, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=timeout) as response:
        emit({'type':'headers', 'status':response.status, 'before':before})
        size = 0
        while True:
            chunk = response.read1(8192)
            if not chunk:
                break
            size += len(chunk)
            if size > 8_000_000:
                raise ValueError('Response size limit')
            emit({'type':'chunk', 'data':base64.b64encode(chunk).decode('ascii')})
    emit({'type':'end', 'after':resources() if request.get('sampleResources') else None})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'type':'error', 'errorType':type(error).__name__})
        sys.exit(1)
