# usage: python3 -I fmt.py pattern[+pattern],… [findings.txt] — one line per pattern group: its findings by song
# (the file as agg.py reads it; default data.txt here — outside the repo).
import sys, collections
rows=[]; slug=None
for line in open(sys.argv[2] if len(sys.argv) > 2 else 'data.txt'):
    line=line.strip()
    if not line: continue
    if '|' not in line: slug=line; continue
    i,s,b,pw,pat=line.split('|'); rows.append((slug,int(s),b,int(pw),pat))
by=collections.defaultdict(list)
for r in rows: by[r[4]].append(r)
for p in sys.argv[1].split(','):
    rs=[r for q in p.split('+') for r in by[q]]
    songs=collections.OrderedDict()
    for r in rs: songs.setdefault(r[0],[]).append(f"{r[1]}:{r[2]}")
    parts=[]
    for s,v in songs.items():
        c=collections.OrderedDict()
        for x in v: c[x]=c.get(x,0)+1
        parts.append(f"{s} " + ", ".join(k+(f"×{n}" if n>1 else "") for k,n in c.items()))
    print(f"[{p}] {len(rs)} findings ({sum(r[3] for r in rs)} play wrong), {len(songs)} songs: " + "; ".join(parts)); print()
