#!/usr/bin/env python3
"""Simulates visitors asking at the same moment, over HTTP, against the running service.
Usage: python3 scripts/loadtest.py [visitors] [base_url]"""
import json, sys, threading, time, urllib.request, urllib.error, os

N = int(sys.argv[1]) if len(sys.argv) > 1 else 4
BASE = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:3100'
QUESTIONS = ['Should we still use the March 31, 2026 IRR?', 'What documents do I need for negotiated procurement?',
             'What are the framework agreement guidelines?', 'When did the IRR of RA 12009 take effect?',
             'What are the rules on tie-breaking?', 'What is market scoping under the IRR?']
rows = [None] * N

def visitor(i):
    q = QUESTIONS[i % len(QUESTIONS)]
    body = json.dumps({'messages': [{'id': f'u{i}', 'role': 'user', 'parts': [{'type': 'text', 'text': q}]}], 'scope': 'all'}).encode()
    # Each simulated visitor has its own address, as they would behind the reverse proxy.
    req = urllib.request.Request(BASE + '/api/chat', body, {'content-type': 'application/json', 'x-forwarded-for': f'198.51.100.{10 + i}'})
    t0 = time.time(); r = {'q': q, 'status': None, 'sources': None, 'first': None, 'done': None, 'chars': 0, 'cites': None}
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            r['status'] = resp.status
            for raw in resp:
                line = raw.decode('utf8', 'ignore').strip()
                if not line.startswith('data: {'): continue
                d = json.loads(line[6:])
                if d['type'] == 'tool-output-available' and r['sources'] is None: r['sources'] = time.time() - t0
                if d['type'] == 'text-delta':
                    if r['first'] is None: r['first'] = time.time() - t0
                    r['chars'] += len(d['delta'])
                if d['type'] == 'finish': r['cites'] = (d.get('messageMetadata') or {}).get('citations', {})
        r['done'] = time.time() - t0
    except urllib.error.HTTPError as e:
        r['status'] = e.code; r['done'] = time.time() - t0
        try: r['message'] = json.loads(e.read()).get('message')
        except Exception: pass
    except Exception as e:
        r['status'] = f'error: {e}'; r['done'] = time.time() - t0
    rows[i] = r

load0 = os.getloadavg()[0]
threads = [threading.Thread(target=visitor, args=(i,)) for i in range(N)]
t0 = time.time()
for t in threads: t.start()
for t in threads: t.join()
f = lambda v: '   —  ' if v is None else f'{v:5.1f}s'
print(f'{N} visitors at once · {BASE}\n')
print('visitor  status  sources  first word    done  answer   check')
for i, r in enumerate(rows):
    c = r.get('cites') or {}
    check = r.get('message') or ('unverified' if c.get('unverified') else 'partially verified' if c.get('partiallyVerified') else f"{len(c.get('cited', []))} sources cited" if c else '')
    print(f"  {i + 1:<6} {str(r['status']):<7} {f(r['sources'])}   {f(r['first'])}    {f(r['done'])}  {r['chars']:>5}   {check}")
print(f'\nwall clock {time.time() - t0:.0f}s · load average {load0:.1f} → {os.getloadavg()[0]:.1f} on {os.cpu_count()} threads')
