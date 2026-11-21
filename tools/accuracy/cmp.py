# usage: python3 -I cmp.py base.mxl new.mxl -> measures whose notes (staff, onset, pitch, dur; voices ignored) differ,
# and per-score counts of voices ending short of / past their measure's longest voice.
import sys, zipfile, xml.etree.ElementTree as ET
from fractions import Fraction as F
from collections import Counter
def load(path):
    z = zipfile.ZipFile(path); name = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META')][0]
    root = ET.fromstring(z.read(name)); res = {}; short = 0; seq = 0
    for P in root.findall('part'):
        div = 1; beats = None
        for m in P.findall('measure'):
            seq += 1
            t = F(0); last = F(0); notes = Counter(); vend = {}
            for e in m:
                if e.tag == 'attributes':
                    d = e.find('divisions')
                    if d is not None: div = int(d.text)
                    tm = e.find('time')
                    if tm is not None and tm.find('beats') is not None: beats = F(int(tm.findtext('beats')) * 4, int(tm.findtext('beat-type')))
                elif e.tag == 'backup': t -= F(int(e.findtext('duration')), div)
                elif e.tag == 'forward': t += F(int(e.findtext('duration')), div)
                elif e.tag == 'note':
                    if e.find('grace') is not None: continue
                    dur = F(int(e.findtext('duration')), div)
                    ch = e.find('chord') is not None
                    on = last if ch else t
                    p = e.find('pitch')
                    s = p.findtext('step') + (p.findtext('alter') or '') + p.findtext('octave') if p is not None else 'R'
                    if e.find('rest') is not None and e.find('rest').get('measure'): s = 'Rm'; dur = F(-1)
                    notes[(e.findtext('staff') or '1', on, s, dur)] += 1
                    if not ch:
                        last = t; t += F(int(e.findtext('duration')), div)
                        k = (e.findtext('staff') or '1', e.findtext('voice')); vend[k] = max(vend.get(k, F(0)), t)
            if vend:
                mx = max(vend.values())
                short += sum(1 for v in vend.values() if v < mx)
            res[(P.get('id'), m.get('number'), seq)] = notes
    return res, short
a, sa = load(sys.argv[1]); b, sb = load(sys.argv[2])
diff = [k for k in sorted(set(a) | set(b), key=lambda k: k[2]) if a.get(k) != b.get(k)]
print(f'measures {len(a)} vs {len(b)}; differing {len(diff)}; voices ending short of their bar: {sa} -> {sb}')
for k in diff:
    x, y = a.get(k, Counter()), b.get(k, Counter())
    gone = sorted((x - y).elements(), key=lambda n: (n[0], n[1])); new = sorted((y - x).elements(), key=lambda n: (n[0], n[1]))
    f = lambda L: ' '.join(f'{s}@{float(o)+1:g}:{n}/{d}' for s, o, n, d in L)
    print(f'  {k[0]} m{k[1]}:  - {f(gone)}\n  {" "*len(k[0])}  {" "*len(k[1])}   + {f(new)}')
