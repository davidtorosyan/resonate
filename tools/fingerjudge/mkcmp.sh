#!/bin/bash
# regenerate the new text and the before/after views
SP=${SP:?the work folder, outside the repo (its fsurvey/ holds xml/ text/ text3/ cmp/ confirmed.json)}
cd /home/user/resonate/tools && DISPLAY=:99 node $SP/fsurvey/text.cjs $SP/fsurvey/xml $SP/fsurvey/text3 r19- >/dev/null 2>&1
cd $SP/fsurvey && python3 - <<'PY'
import json,re,os
c=json.load(open('confirmed.json'))
def bars_of(x):
    s=(x.get('bars') or '')+','+(x.get('otherBars') or '')
    out=set()
    for a,b in re.findall(r'(\d+)\s*[-–]\s*(\d+)', s):
        a,b=int(a),int(b)
        if b>=a and b-a<12: out.update(range(a,b+1))
    for n in re.findall(r'\d+', re.sub(r'(\d+)\s*[-–]\s*(\d+)','',s)): out.add(int(n))
    return sorted(out)
def load(d,song):
    m={}
    for l in open(f'{d}/r19-{song}.txt'):
        g=re.match(r'Bar (\S+) — ',l)
        if g: m[g.group(1)]=l.rstrip()
    return m
os.makedirs('cmp',exist_ok=True)
by={}
for x in c: by.setdefault(x['song'],[]).append(x)
for song,xs in by.items():
    old,new=load('text',song),load('text3',song)
    out=[]
    for x in xs:
        out.append(f"### {x['id']} [{x['pattern']}, {x['severity']}] bars {x['bars']} (also {x.get('otherBars','')}) hand {x['hand']}\nGIVEN: {x['given']}\nBETTER: {x['better']}\nWHY: {x['why']}\n")
        for b in bars_of(x)[:14]:
            b=str(b); o,n=old.get(b,'(none)'),new.get(b,'(none)')
            out.append(f"  old {o}\n  new {n}" if o!=n else f"  same {o}")
        out.append('')
    open(f'cmp/{song}.md','w').write('\n'.join(out))
    ch=[b for b in new if old.get(b)!=new[b]]
    open(f'cmp/{song}-changed.md','w').write('\n'.join(f"old {old.get(b,'(none)')}\nnew {new[b]}\n" for b in ch))
    print(song, len(ch), 'bars changed')
PY
