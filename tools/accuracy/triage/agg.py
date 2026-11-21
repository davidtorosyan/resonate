# usage: python3 -I agg.py findings.txt [pattern,pattern…] — the comparison's findings per pattern.
# findings.txt (outside the repo: it names the owner's bars): a song's slug on its own line, then
# id|system|bar|plays wrong (0/1)|pattern lines.
import sys, collections
rows=[]; slug=None
for line in open(sys.argv[1]):
    line=line.strip()
    if not line: continue
    if '|' not in line: slug=line; continue
    i,s,b,pw,pat=line.split('|'); rows.append((slug,int(s),b,int(pw),pat))
print('total',len(rows))
for s,n in collections.Counter(r[0] for r in rows).items(): print(' ',s,n)
by=collections.defaultdict(list)
for r in rows: by[r[4]].append(r)
order=sys.argv[2].split(',') if len(sys.argv)>2 else sorted(by)
for p in order:
    rs=by[p]; songs=collections.OrderedDict()
    for r in rs: songs.setdefault(r[0],[]).append(r)
    lst='; '.join(f"{s} "+', '.join(f"s{r[1]} b{r[2]}" for r in v) for s,v in songs.items())
    print(f"## {p}: {len(rs)} findings, {len(songs)} songs, plays wrong {sum(r[3] for r in rs)}")
    print('   '+lst)
