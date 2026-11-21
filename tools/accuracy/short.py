# usage: python3 -I short.py score.mxl -> each measure where a voice ends before the measure's longest voice
import sys, zipfile, xml.etree.ElementTree as ET
from fractions import Fraction as F
z = zipfile.ZipFile(sys.argv[1]); name = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META')][0]
root = ET.fromstring(z.read(name))
for P in root.findall('part'):
    div = 1
    for m in P.findall('measure'):
        t = F(0); vend = {}; vstart = {}
        for e in m:
            if e.tag == 'attributes' and e.find('divisions') is not None: div = int(e.findtext('divisions'))
            elif e.tag == 'backup': t -= F(int(e.findtext('duration')), div)
            elif e.tag == 'forward': t += F(int(e.findtext('duration')), div)
            elif e.tag == 'note' and e.find('chord') is None and e.find('grace') is None:
                k = (e.findtext('staff') or '1', e.findtext('voice'))
                vstart.setdefault(k, t); t += F(int(e.findtext('duration')), div); vend[k] = max(vend.get(k, F(0)), t)
        if not vend: continue
        mx = max(vend.values())
        s = [f'st{k[0]}v{k[1]} {float(vstart[k]):g}-{float(v):g}' for k, v in vend.items() if v < mx]
        if s: print(f'{P.get("id")} m{m.get("number")} (len {float(mx):g}): ' + ', '.join(s))
