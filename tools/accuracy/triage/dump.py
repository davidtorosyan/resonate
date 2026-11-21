# usage: python3 -I dump.py score.mxl PART|'*' FROM TO — every element of bars FROM..TO as the engine wrote
# them: onsets, staves, voices, ties / tied / slurs, accidentals, tuplets, lyrics' numbers, default-x.
import sys, zipfile, re
import xml.etree.ElementTree as ET
from fractions import Fraction as F
path, part_sel, m0, m1 = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
z = zipfile.ZipFile(path)
name = [n for n in z.namelist() if n.endswith('.xml') and 'META' not in n][0]
root = ET.fromstring(z.read(name))
for part in root.findall('part'):
    pid = part.get('id')
    if part_sel != '*' and pid != part_sel: continue
    div = 1
    for mi, meas in enumerate(part.findall('measure')):
        num = meas.get('number')
        try: n = int(re.sub(r'\D','',num) or -1)
        except: n = -1
        t = F(0); last = F(0)
        out = []
        for el in meas:
            if el.tag == 'attributes':
                d = el.find('divisions')
                if d is not None: div = int(d.text)
                for k in el.findall('key'): out.append(f"   KEY fifths={k.findtext('fifths')} num={k.get('number')}")
                for c in el.findall('clef'): out.append(f"   CLEF {c.findtext('sign')}{c.findtext('line')} oct={c.findtext('clef-octave-change')} num={c.get('number')}")
                tm = el.find('time')
                if tm is not None: out.append(f"   TIME {tm.findtext('beats')}/{tm.findtext('beat-type')}")
            elif el.tag == 'backup': t -= F(int(el.findtext('duration')), div)
            elif el.tag == 'forward': t += F(int(el.findtext('duration')), div)
            elif el.tag == 'direction':
                txt = ' '.join((w.text or '') for w in el.iter('words'))
                kinds = [c.tag for c in el.find('direction-type')] if el.find('direction-type') is not None else []
                snd = el.find('sound')
                out.append(f"   DIR {kinds} {'(words)' if txt.strip() else ''} sound={snd.attrib if snd is not None else ''}")
            elif el.tag == 'barline':
                rep = el.find('repeat'); end = el.find('ending')
                out.append(f"   BAR {el.get('location')} rep={rep.attrib if rep is not None else ''} end={end.attrib if end is not None else ''}")
            elif el.tag == 'note':
                chord = el.find('chord') is not None
                dur = el.findtext('duration')
                d = F(int(dur), div) if dur else F(0)
                start = last if chord else t
                p = el.find('pitch')
                if p is not None:
                    alt = p.findtext('alter') or ''
                    ps = p.findtext('step') + {'1':'#','-1':'b','':'','0':'n','2':'x','-2':'bb'}.get(alt, alt) + p.findtext('octave')
                elif el.find('rest') is not None: ps = 'rest'
                else: ps = 'unp'
                ties = ''.join('>' if x.get('type')=='start' else '<' for x in el.findall('tie'))
                tied = ''.join('>' if x.get('type')=='start' else '<' for x in el.iter('tied'))
                slurs = ''.join(('S' if x.get('type')=='start' else 's')+x.get('number','1') for x in el.iter('slur'))
                acc = el.findtext('accidental') or ''
                typ = el.findtext('type') or ''
                dots = '.'*len(el.findall('dot'))
                grace = 'g' if el.find('grace') is not None else ''
                cue = 'cue' if el.find('cue') is not None or (el.find('type') is not None and el.find('type').get('size')=='cue') else ''
                tm = el.find('time-modification')
                tmod = f"{tm.findtext('actual-notes')}:{tm.findtext('normal-notes')}" if tm is not None else ''
                lyr = ','.join(l.get('number','1')+(l.findtext('syllabic') or '')[:1] for l in el.findall('lyric'))
                dx = el.get('default-x') or ''
                out.append(f"  @{float(start*1+1):.3f} st{el.findtext('staff')} v{el.findtext('voice')} {'+' if chord else ' '}{ps:6} {typ}{dots}{grace}{cue} d={d} tie={ties} tied={tied} {slurs} acc={acc} tm={tmod} lyr={lyr} x={dx}")
                if not chord:
                    last = t; t += d
        if m0 <= n <= m1:
            print(f"== {pid} m{num}"); print('\n'.join(out))
