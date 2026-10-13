import urllib.request, json, time

tests = [
    ('lonely',                  'Lonely'),
    ('bonita jeeiph',           'Bonita'),
    ('la ultima vez de anuel',  'La Ultima Vez'),
    ('bad bunny',               None),
    ('shape of you',            None),
]

for q, expected in tests:
    t = time.time()
    try:
        d = json.loads(urllib.request.urlopen(
            f'http://localhost:8000/api/search?q={urllib.parse.quote(q)}').read())
        elapsed = round(time.time()-t, 2)
        results = d.get('results', [])
        top     = results[0] if results else None
        ok = ('OK' if (not expected or (top and expected.lower() in top['title'].lower())) else 'FAIL')
        vid = top['audioSrc'] if top else None
        print(f"[{ok}] '{q}' -> '{top['title'] if top else 'NO RESULTS'}' vid={vid} ({elapsed}s)")
    except Exception as e:
        print(f"[ERR] '{q}': {e}")

import urllib.parse

# Test resolve
print()
for title, artist, expected_vid in [
    ('bonita',          'jeeiph',    '2euymKyjVGg'),
    ('La Ultima Vez',   'Anuel AA',  'r_wYm0xR68w'),
]:
    t = time.time()
    try:
        d = json.loads(urllib.request.urlopen(
            f'http://localhost:8000/api/resolve?title={urllib.parse.quote(title)}&artist={urllib.parse.quote(artist)}'
        ).read())
        vid = d.get('audioSrc')
        ok = 'OK' if vid == expected_vid else f'FAIL (expected {expected_vid})'
        print(f"[{ok}] resolve '{title}' -> {vid} ({round(time.time()-t,2)}s)")
    except Exception as e:
        print(f"[ERR] resolve '{title}': {e}")
