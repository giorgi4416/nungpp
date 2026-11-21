# Dev helper: write an optimizer SEGMENTS_JSON line back into a circuit definition file.
# Usage: python tools/apply-layout.py src/track/circuits/<id>.js optimizer-output.txt
import json, sys

path, src = sys.argv[1], sys.argv[2]
line = [l for l in open(src, encoding='utf-8') if l.startswith('SEGMENTS_JSON ')][0]
segs = json.loads(line[len('SEGMENTS_JSON '):])
out = ''
for r in segs:
    if 't' in r:
        sign = '+' if r['dir'] > 0 else '-'
        out += f"    {{ t: '{r['t']}', n: {r['n']}, dir: {sign}1, ang: {r['ang']}, r: {r['r']} }},\n"
    else:
        val = f"'{r['s']}'" if isinstance(r['s'], str) else str(r['s'])
        tag = f", tag: '{r['tag']}'" if r.get('tag') else ''
        out += f"    {{ s: {val}{tag} }},\n"
s = open(path, encoding='utf-8').read()
a = s.index('  segments: [')
b = s.index('  ],\n', a) + 5
s = s[:a] + '  segments: [\n' + out + '  ],\n' + s[b:]
open(path, 'w', encoding='utf-8').write(s)
