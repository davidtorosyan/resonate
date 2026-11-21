# usage: python3 -I bar.py score.mxl|xml PART MEASURE[,MEASURE..]  -> notes with onsets (quarters) per voice
import sys, zipfile, xml.etree.ElementTree as ET
from fractions import Fraction as F
path, part, ms = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
if path.endswith('.mxl'):
    z = zipfile.ZipFile(path); name = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META')][0]; root = ET.fromstring(z.read(name))
else: root = ET.parse(path).getroot()
P = [p for p in root.findall('part') if p.get('id') == part][0]
div = 1
for m in P.findall('measure'):
    a = m.find('attributes/divisions')
    if a is not None: div = int(a.text)
    if m.get('number') not in ms: continue
    t = F(0); out = []; last = F(0)
    for e in m:
        if e.tag == 'attributes':
            d = e.find('divisions')
            if d is not None: div = int(d.text)
        if e.tag == 'backup': t -= F(int(e.find('duration').text), div)
        elif e.tag == 'forward': t += F(int(e.find('duration').text), div)
        elif e.tag == 'note':
            dur = F(int(e.find('duration').text), div) if e.find('duration') is not None else F(0)
            ch = e.find('chord') is not None
            on = last if ch else t
            p = e.find('pitch'); r = e.find('rest')
            s = (p.find('step').text + {'1':'#','-1':'b'}.get(getattr(p.find('alter'),'text',None),'') + p.find('octave').text) if p is not None else ('R(meas)' if r is not None and r.get('measure') else 'R')
            tie = ''.join(x.get('type')[0:2] for x in e.findall('tie'))
            out.append((e.findtext('staff') or '1', e.findtext('voice'), on, dur, s, tie, e.get('default-x')))
            if not ch: last = t; t += dur
    print(f'--- {part} m{m.get("number")} (id {m.get("id")})')
    for st, v, on, dur, s, tie, x in sorted(out, key=lambda o: (o[0], o[1], o[2])):
        print(f'  staff {st} v{v}  @{float(on)+1:<5} {str(dur):>4}  {s:<8} {tie:<6} x={x}')
