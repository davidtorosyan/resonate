#!/usr/bin/env python3
"""Build a Reader (public/omr/reader.js) fixture from a real native Audiveris run — no engine.

  python3 readerfixture.py <book.omr> <book.mxl> <native.log> <score.pdf> <outdir> [--name N] [--per-page S]

Writes <outdir>/events.json ({ name, events: [{ at: ms, ev }] }, the event contract of
public/omr/readerstate.js) and <outdir>/p<N>.webp (each PDF page binarized like pdfprep, 1100 px on
its long side). Sheet numbers become browser ones (s = 1.. over the music pages), timing comes from
the native log's step timestamps scaled to --per-page seconds a page (iPhone ≈ 30 s), per-system
'sym' events spread evenly over each step. Which step "adds" a kind is the fixture's choice (the
book only has the final symbols): HEADERS clef/key/time, BEAMS beam, LEDGERS ledger, HEADS head,
STEMS stem, TEXTS word/lyric (after the page's 'words'), MEASURES bar, CURVES slur/tie,
SYMBOLS rest/acc/flag/dot/other. Notes come from the exported MusicXML (default-x → sheet px, y from
the matching head). The owner's scores make owner fixtures: keep them OUT of the repo.
"""
import sys, os, re, json, zipfile, subprocess, tempfile, argparse
from fractions import Fraction
import xml.etree.ElementTree as ET
from datetime import datetime
from PIL import Image

STEPS = ['LOAD', 'BINARY', 'SCALE', 'GRID', 'HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS',
         'STEMS', 'REDUCTION', 'CUE_BEAMS', 'TEXTS', 'MEASURES', 'CHORDS', 'CURVES', 'SYMBOLS', 'LINKS', 'RHYTHMS', 'PAGE']
PER_SYSTEM = {'HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS', 'STEMS', 'REDUCTION', 'CUE_BEAMS',
              'TEXTS', 'MEASURES', 'CHORDS', 'SYMBOLS', 'LINKS', 'CURVES'}
KIND_STEP = {'clef': 'HEADERS', 'key': 'HEADERS', 'time': 'HEADERS', 'beam': 'BEAMS', 'ledger': 'LEDGERS',
             'head': 'HEADS', 'stem': 'STEMS', 'word': 'TEXTS', 'lyric': 'TEXTS', 'bar': 'MEASURES',
             'slur': 'CURVES', 'tie': 'CURVES', 'rest': 'SYMBOLS', 'acc': 'SYMBOLS', 'flag': 'SYMBOLS',
             'dot': 'SYMBOLS', 'other': 'SYMBOLS'}
ACC = {'SHARP': '♯', 'FLAT': '♭', 'NATURAL': '♮', 'DOUBLE_SHARP': '𝄪', 'DOUBLE_FLAT': '𝄫'}
CLEF = {'TREBLE': 'G', 'BASS': 'F', 'ALTO': 'C', 'TENOR': 'C'}


def kind_of(e):
    tag = e.tag
    if tag == 'head': return 'head', None
    if tag == 'stem': return 'stem', None
    if tag in ('beam', 'beam-hook', 'small-beam'): return 'beam', None
    if tag == 'ledger': return 'ledger', None
    if tag == 'rest': return 'rest', None
    if tag == 'clef' and e.get('shape'):
        v = CLEF.get(e.get('kind', ''), e.get('shape', '')[:1])
        if '8VB' in e.get('shape', ''): v += '8vb'
        return 'clef', v
    if tag == 'key' and e.get('fifths') is not None:
        f = int(e.get('fifths'))
        return 'key', (f'{f}♯' if f > 0 else f'{-f}♭' if f < 0 else '0')
    if tag.startswith('time-'): return 'time', e.get('time-rational')
    if tag == 'barline': return 'bar', None
    if tag == 'slur': return ('tie' if e.get('tie') == 'true' else 'slur'), ('above' if e.get('above') == 'true' else 'below')
    if tag == 'word': return 'word', e.get('value')
    if tag == 'lyric-item':
        if e.get('kind') != 'Syllable': return None, None
        return 'lyric', e.get('value')
    if tag == 'flag': return 'flag', None
    if tag == 'augmentation-dot': return 'dot', None
    if tag == 'alter': return 'acc', ACC.get(e.get('shape', ''), None)
    if tag in ('dynamics', 'articulation', 'fermata', 'caesura', 'metronome', 'pedal', 'wedge', 'ornament',
               'tuplet', 'fingering', 'arpeggiato', 'breath-mark', 'marker', 'segno', 'coda'):
        return 'other', e.get('shape')
    return None, None


def bounds(e):
    b = e.find('bounds')
    if b is None: return None
    return int(b.get('x')), int(b.get('y')), int(b.get('w')), int(b.get('h'))


def parse_sheet(xml_bytes):
    r = ET.fromstring(xml_bytes)
    pic = r.find('picture')
    W, H = int(pic.get('width')), int(pic.get('height'))
    inter = int(r.find('scale/interline').get('main'))
    systems = []
    for sysel in r.iter('system'):
        sid = int(sysel.get('id'))
        staves = []
        for part in sysel.findall('part'):
            for st in part.findall('staff'):
                lines = []
                for ln in st.findall('lines/line'):
                    pts = ln.findall('point')
                    lines.append([round(float(pts[0].get('y'))), round(float(pts[-1].get('y')))])
                staves.append({'id': int(st.get('id')), 'part': int(part.get('id')),
                               'x0': int(st.get('left')), 'x1': int(st.get('right')), 'lines': lines})
        syms = []
        for inters in sysel.iter('inters'):
            for e in inters:
                k, v = kind_of(e)
                if not k: continue
                b = bounds(e)
                if not b: continue
                s = {'id': int(e.get('id')), 'k': k, 'x': b[0], 'y': b[1], 'w': b[2], 'h': b[3]}
                if v: s['v'] = v
                if k == 'head': s['staff'] = int(e.get('staff', 0))
                syms.append(s)
        l = min(s['x0'] for s in staves); r_ = max(s['x1'] for s in staves)
        t = min(s['lines'][0][0] for s in staves) - 2 * inter
        b = max(s['lines'][-1][0] for s in staves) + 2 * inter
        for s in syms:  # the system's own contents (lyrics under the staff, a title above system 1)
            if s['k'] in ('lyric', 'head', 'rest', 'slur', 'tie', 'ledger', 'other'):
                t = min(t, s['y']); b = max(b, s['y'] + s['h'])
        stacks = [(int(sk.get('left')), int(sk.get('right'))) for sk in sysel.findall('stack')]
        systems.append({'id': sid, 'box': [l, max(0, t - 6), r_, min(H, b + 6)], 'staves': staves,
                        'syms': syms, 'stacks': stacks})
    return {'W': W, 'H': H, 'interline': inter, 'systems': systems}


def dur_of(note, div):
    d = note.find('duration')
    if d is None: return None
    f = Fraction(int(d.text), div * 4)
    return f'{f.numerator}/{f.denominator}'


def notes_by_system(mxl_bytes, sheets, first_sheet):
    """[sheet][system] → note records, walking every part's measures with <print new-system/page>."""
    root = ET.fromstring(mxl_bytes)
    out = {}
    for pi, part in enumerate(root.findall('part')):
        sheet, sysi, mi = first_sheet, 0, -1
        div = 1
        for m in part.findall('measure'):
            pr = m.find('print')
            if pr is not None and pr.get('new-page') == 'yes': sheet += 1; sysi = 0; mi = -1
            elif pr is not None and pr.get('new-system') == 'yes': sysi += 1; mi = -1
            mi += 1
            a = m.find('attributes/divisions')
            if a is not None: div = int(a.text)
            sh = sheets.get(sheet)
            if not sh or sysi >= len(sh['systems']): continue
            sysd = sh['systems'][sysi]
            if mi >= len(sysd['stacks']): continue
            left = sysd['stacks'][mi][0]
            k = sh['interline'] / 10
            heads = [s for s in sysd['syms'] if s['k'] == 'head']
            pstaves = [st['id'] for st in sysd['staves'] if st['part'] == pi + 1]
            chord = []
            def flush():
                if not chord: return
                xs = chord[0]['x']
                sid = pstaves[min(len(pstaves), chord[0]['_staff']) - 1] if pstaves else None
                cands = sorted([h for h in heads if abs(h['x'] - xs) <= 4 and (sid is None or h['staff'] == sid)], key=lambda h: h['y'])
                order = sorted(chord, key=lambda n: -n['_midi'])
                for i, n in enumerate(order):
                    h = cands[i] if i < len(cands) else (cands[-1] if cands else None)
                    n['x'] = (h['x'] + h['w'] // 2) if h else round(xs + 10)
                    n['y'] = (h['y'] + h['h'] // 2) if h else None
                    del n['_midi']; del n['_staff']
                    if n['y'] is not None:
                        out.setdefault(sheet, {}).setdefault(sysd['id'], []).append(n)
                chord.clear()
            for n in m.findall('note'):
                if n.find('rest') is not None or n.find('grace') is not None or n.find('cue') is not None: continue
                p = n.find('pitch')
                if p is None or n.get('default-x') is None: continue
                if n.find('chord') is None: flush()
                step = p.find('step').text; octv = int(p.find('octave').text)
                alter = int(float(p.find('alter').text)) if p.find('alter') is not None else 0
                rec = {'m': int(re.sub(r'\D', '', m.get('number')) or 0), 'x': left + float(n.get('default-x')) * k,
                       'step': step, 'alter': alter, 'oct': octv, 'dur': dur_of(n, div),
                       'voice': int(n.find('voice').text) if n.find('voice') is not None else 1,
                       '_midi': 12 * (octv + 1) + 'C D EF G A B'.index(step) + alter,
                       '_staff': int(n.find('staff').text) if n.find('staff') is not None else 1}
                ly = n.find('lyric/text')
                if ly is not None and ly.text: rec['syl'] = ly.text
                chord.append(rec)
            flush()
    for sh in out.values():
        for lst in sh.values(): lst.sort(key=lambda n: (n['x'], n['y']))
    return out


def step_times(log_path):
    """{sheet: [(step, t_seconds)...]} plus each sheet's end, from the native log's timestamps."""
    res, ends = {}, {}
    for line in open(log_path, encoding='utf-8', errors='replace'):
        m = re.match(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),(\d+) INFO \[[^\]#]*(?:#(\d+))?\][^|]*\|\s*([A-Z_]+)\s*$', line)
        t = None
        mt = re.match(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),(\d+)', line)
        if mt: t = datetime.strptime(mt.group(1), '%Y-%m-%d %H:%M:%S').timestamp() + int(mt.group(2)) / 1000
        if m and m.group(4) in STEPS:
            res.setdefault(int(m.group(3) or 1), []).append((m.group(4), t))  # a one-sheet book logs [name], no #N
        me = re.search(r'End of Stub#(\d+)', line)
        if me and t: ends[int(me.group(1))] = t
    return res, ends


def previews(pdf, outdir, long_side=1100):
    tmp = tempfile.mkdtemp()
    subprocess.run(['pdftoppm', '-r', '300', '-gray', pdf, os.path.join(tmp, 'p')], check=True)
    files = sorted(f for f in os.listdir(tmp) if f.endswith('.pgm'))
    info = []
    for i, f in enumerate(files, 1):
        im = Image.open(os.path.join(tmp, f))
        W, H = im.size
        bw = im.point(lambda v: 0 if v < 200 else 255)  # pdfprep's cut: darker than ~80% white is ink
        ink = sum(1 for v in bw.resize((W // 8, H // 8)).tobytes() if v < 128) / ((W // 8) * (H // 8))
        sc = long_side / max(W, H)
        small = bw.resize((round(W * sc), round(H * sc)), Image.LANCZOS)
        small.save(os.path.join(outdir, f'p{i}.webp'), 'WEBP', quality=82, method=5)
        info.append({'W': W, 'H': H, 'ink': ink})
        os.remove(os.path.join(tmp, f))
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('omr'); ap.add_argument('mxl'); ap.add_argument('log'); ap.add_argument('pdf'); ap.add_argument('out')
    ap.add_argument('--name', default=None); ap.add_argument('--per-page', type=float, default=30.0)
    ap.add_argument('--title', default=None); ap.add_argument('--tempo', type=int, default=None)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    z = zipfile.ZipFile(a.omr)
    native = {}
    for n in z.namelist():
        m = re.match(r'sheet#(\d+)/sheet#\d+\.xml$', n)
        if m: native[int(m.group(1))] = parse_sheet(z.read(n))
    music_pages = sorted(native)  # native sheet numbers = PDF page numbers
    s_of = {p: i + 1 for i, p in enumerate(music_pages)}
    mz = zipfile.ZipFile(a.mxl)
    xmlname = [n for n in mz.namelist() if n.endswith('.xml') and not n.startswith('META')][0]
    mxl = mz.read(xmlname)
    notes = notes_by_system(mxl, native, music_pages[0])
    times, ends = step_times(a.log)
    info = previews(a.pdf, a.out)
    npages = len(info)
    name = a.name or os.path.basename(a.pdf)

    ev = []
    t = 0.0
    def push(dt, e):
        nonlocal t
        t += dt
        ev.append({'at': round(t * 1000), 'ev': e})
    push(0, {'t': 'job', 'id': 'fixture-' + re.sub(r'\W+', '-', name), 'name': name, 'size': os.path.getsize(a.pdf), 'resumed': False})
    push(0.05, {'t': 'phase', 'phase': 'pages'})
    for i, inf in enumerate(info, 1):
        sh = native.get(i)
        staves = []
        if sh:
            for sysd in sh['systems']:
                for st in sysd['staves']:
                    staves.append({'x0': st['x0'], 'x1': st['x1'], 'y': [l[0] for l in st['lines']]})
        e = {'t': 'page', 'page': i, 'of': npages, 'w': inf['W'], 'h': inf['H'], 'music': bool(sh),
             'blank': inf['ink'] < 0.005, 'preview': f'p{i}.webp', 'staves': staves}
        if sh: e['s'] = s_of[i]
        push(1.1 if i > 1 else 0.6, e)
        if i == 1 and (a.title or a.tempo):
            m = {'t': 'meta'}
            if a.title: m['title'] = a.title
            if a.tempo: m['tempo'] = {'bpm': a.tempo, 'unit': 'quarter', 'dotted': False}
            push(0.05, m)
    push(0.3, {'t': 'phase', 'phase': 'engine'})
    for ms, dt in (('fetch', 0.4), ('jvm', 5.5), ('start', 3.0), ('font', 2.2), ('book', 1.8)):
        e = {'t': 'engine', 'milestone': ms}
        if ms == 'book': e['detail'] = f'{len(music_pages)} sheets'
        push(dt, e)
    push(0.2, {'t': 'phase', 'phase': 'read'})

    for p in music_pages:
        s = s_of[p]; sh = native[p]
        st = times.get(p, [])
        end = ends.get(p) or (st[-1][1] + 1 if st else 0)
        total = end - st[0][1] if st else 15
        scale = a.per_page / total
        push(0.05, {'t': 'sheet', 's': s, 'state': 'start'})
        sheet_t0 = t
        by_step = {}
        for sysd in sh['systems']:
            for sym in sysd['syms']:
                by_step.setdefault((KIND_STEP[sym['k']], sysd['id']), []).append(sym)
        for i, (step, ts) in enumerate(st):
            nxt = st[i + 1][1] if i + 1 < len(st) else end
            dur = max(0.05, (nxt - ts) * scale)
            push(0, {'t': 'step', 's': s, 'step': step})
            t_step = t
            if step == 'GRID':
                t += dur * 0.85
                push(0, {'t': 'grid', 's': s, 'systems': [{'id': d['id'], 'box': d['box'], 'staves': d['staves']} for d in sh['systems']]})
                t = t_step + dur
                continue
            if step == 'TEXTS':
                words = [{k: sym[k] for k in ('x', 'y', 'w', 'h')} | {'text': sym['v']} for d in sh['systems'] for sym in d['syms'] if sym['k'] in ('word', 'lyric')]
                words.sort(key=lambda w: (round(w['y'] / 40), w['x']))
                t += dur * 0.6
                push(0, {'t': 'words', 's': s, 'words': words})
                rest = dur * 0.4
            else:
                rest = dur
            if step in PER_SYSTEM:
                n = len(sh['systems'])
                for d in sh['systems']:
                    add = [{k: v for k, v in sym.items() if k != 'staff'} for sym in by_step.get((step, d['id']), [])]
                    push(rest / n, {'t': 'sym', 's': s, 'step': step, 'sys': d['id'], 'add': add, 'del': []})
                    if step == 'MEASURES':
                        xs = sorted({d['stacks'][0][0]} | {r for (_, r) in d['stacks']})
                        push(0, {'t': 'measures', 's': s, 'sys': d['id'], 'xs': xs})
            else:
                t += rest
            if step == 'PAGE':
                for d in sh['systems']:
                    lst = notes.get(p, {}).get(d['id'], [])
                    push(0.02, {'t': 'notes', 's': s, 'sys': d['id'], 'notes': [dict(n, x=round(n['x'])) for n in lst]})
        push(0.1, {'t': 'sheet', 's': s, 'state': 'done', 'ms': round((t - sheet_t0) * 1000)})

    push(0.3, {'t': 'phase', 'phase': 'export'})
    text = mxl.decode('utf-8')
    pl = re.search(r'\s*<part-list>.*?</part-list>', text, re.S)
    first = re.search(r'(\s*<note default-x[^>]*>(?:(?!</note>).)*<lyric.*?</note>(?:\s*<note.*?</note>){2})', text, re.S)
    push(4.0 * a.per_page / 30, {'t': 'xml', 'text': pl.group(0).strip('\n') if pl else ''})
    if first: push(0.4, {'t': 'xml', 'text': first.group(1).strip('\n')})
    push(0.6, {'t': 'phase', 'phase': 'clean'})
    for msg in ('part P2: ties restored (m3, m12, m14)', 'key signatures unified: 2 segments', 'tempo from the PDF: ♩ = 100'):
        push(0.25, {'t': 'fix', 'msg': msg})
    push(0.3, {'t': 'phase', 'phase': 'save'})
    push(0.6, {'t': 'done', 'songId': 's-fixture', 'title': a.title or name})
    push(0, {'t': 'phase', 'phase': 'done'})
    json.dump({'name': name, 'events': ev}, open(os.path.join(a.out, 'events.json'), 'w'), ensure_ascii=False)
    kinds = {}
    for e in ev:
        kinds[e['ev']['t']] = kinds.get(e['ev']['t'], 0) + 1
    print(f'{len(ev)} events over {ev[-1]["at"] / 1000:.1f} s', kinds)


if __name__ == '__main__':
    main()
