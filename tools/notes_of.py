import sys, zipfile, xml.etree.ElementTree as ET
def notes(path):
    data = zipfile.ZipFile(path).read([n for n in zipfile.ZipFile(path).namelist() if n.endswith('.xml') and 'META' not in n][0]) if path.endswith('.mxl') else open(path,'rb').read()
    r = ET.fromstring(data); out = []
    for p in r.findall('part'):
        for mi, m in enumerate(p.findall('measure'), 1):
            for n in m.findall('note'):
                pt = n.find('pitch')
                pitch = (pt.findtext('step') + (pt.findtext('alter') or '') + pt.findtext('octave')) if pt is not None else 'rest'
                ly = '|'.join((l.findtext('text') or '') for l in n.findall('lyric'))
                out.append(f"{p.get('id')} m{mi} v{n.findtext('voice')} {pitch} {n.findtext('type')}{'.'*len(n.findall('dot'))} {'chord ' if n.find('chord') is not None else ''}{'tie ' if n.find('tie') is not None else ''}{ly}")
    return out
a, b = notes(sys.argv[1]), notes(sys.argv[2])
import difflib
d = [l for l in difflib.unified_diff(a, b, lineterm='', n=0) if not l.startswith(('---', '+++', '@@'))]
print(f"notes: {len(a)} vs {len(b)}; differing lines: {len(d)}")
for l in d[:20]: print(l)
