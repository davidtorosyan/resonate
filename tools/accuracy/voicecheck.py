# usage: python3 -I voicecheck.py score.mxl -> per measure/voice: overlaps, mid-voice gaps, positions past the bar
import sys, zipfile, xml.etree.ElementTree as ET
from fractions import Fraction as F
z = zipfile.ZipFile(sys.argv[1]); name = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META')][0]
root = ET.fromstring(z.read(name))
for P in root.findall('part'):
    div = 1; beats, bt = 4, 4
    for m in P.findall('measure'):
        t = F(0); last = F(0); ends = {}; issues = []
        for e in m:
            if e.tag == 'attributes':
                d = e.find('divisions')
                if d is not None: div = int(d.text)
                ti = e.find('time')
                if ti is not None and ti.find('beats') is not None: beats, bt = int(ti.find('beats').text), int(ti.find('beat-type').text)
            elif e.tag == 'backup': t -= F(int(e.find('duration').text), div)
            elif e.tag == 'forward':
                v = e.findtext('voice')
                t += F(int(e.find('duration').text), div)
                pass
            elif e.tag == 'note':
                if e.find('grace') is not None: continue
                dur = F(int(e.find('duration').text), div)
                v = e.findtext('voice'); st = e.findtext('staff')
                if e.find('chord') is not None: continue
                if t < 0: issues.append(f'neg pos v{v}')
                if v in ends:
                    pe = ends[v]
                    if t < pe: issues.append(f'overlap v{v}@{t}<{pe}')
                    elif t > pe: issues.append(f'gap v{v} {pe}->{t}')
                ends[v] = t + dur; t += dur
        exp = F(beats * 4, bt)
        for v, e_ in ends.items():
            if e_ > exp: issues.append(f'v{v} ends {e_}>{exp}')
        if issues: print(P.get('id'), 'm' + m.get('number'), '; '.join(issues))
