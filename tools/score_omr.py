#!/usr/bin/env python3
"""Score an OMR MusicXML (.mxl/.musicxml) vocal line against a ground-truth JSON.

usage: score_omr.py groundtruth.json output.mxl [--verbose]

Ground truth: {"measures":[{"number","notes":[{"rest","pitch","type","dots","lyric",...}]}]}
The OMR file's melody is the part+voice with the most lyrics (as the Sing page picks it).
Notes (not rests) are aligned with an edit-distance DP so one missed/extra note doesn't
shift every later comparison. Reports recall/precision of notes and accuracy of pitch,
rhythm (type+dots) and lyric syllables over the aligned pairs.
"""
import json, re, sys, zipfile, unicodedata
import xml.etree.ElementTree as ET

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi_of(pitch):
    m = re.fullmatch(r"([A-G])(#{1,2}|b{1,2}|n)?(-?\d)", pitch.strip())
    if not m:
        return None
    acc = {"#": 1, "##": 2, "b": -1, "bb": -2, "n": 0, None: 0}[m.group(2)]
    return (int(m.group(3)) + 1) * 12 + STEP[m.group(1)] + acc


def norm_lyric(t):
    t = unicodedata.normalize("NFKC", t or "").lower()
    return re.sub(r"[^a-z0-9']", "", t)


def load_gt(path):
    gt = json.load(open(path))
    out = []
    for m in gt["measures"]:
        for n in m["notes"]:
            if n.get("rest"):
                continue
            out.append({"midi": midi_of(n["pitch"]), "dur": (n["type"], int(n.get("dots") or 0)),
                        "lyric": norm_lyric(n.get("lyric")), "measure": m["number"], "pitch": n["pitch"],
                        "rawlyric": n.get("lyric") or ""})
    return out


def read_xml(path):
    if path.endswith(".mxl"):
        z = zipfile.ZipFile(path)
        names = [n for n in z.namelist() if not n.startswith("META-INF") and n.endswith((".xml", ".musicxml"))]
        return z.read(names[0])
    return open(path, "rb").read()


def load_omr(path):
    root = ET.fromstring(read_xml(path))
    best = None
    for part in root.findall("part"):
        counts = {}
        for n in part.iter("note"):
            if n.find("lyric") is not None:
                v = n.findtext("voice") or "1"
                counts[v] = counts.get(v, 0) + 1
        for v, c in counts.items():
            if best is None or c > best[2]:
                best = (part, v, c)
    if best is None:
        part = root.find("part")
        best = (part, "1", 0)
    part, voice, _ = best
    out = []
    for mi, m in enumerate(part.findall("measure"), 1):
        for n in m.findall("note"):
            if (n.findtext("voice") or "1") != voice or n.find("rest") is not None:
                continue
            if n.find("chord") is not None or n.find("grace") is not None:
                continue
            p = n.find("pitch")
            if p is None:
                continue
            alter = round(float(p.findtext("alter") or 0))
            midi = (int(p.findtext("octave")) + 1) * 12 + STEP[p.findtext("step")] + alter
            lyr = ""
            for l in n.findall("lyric"):
                if l.get("number") in (None, "1"):
                    lyr = "".join(t.text or "" for t in l.findall("text"))
                    break
            out.append({"midi": midi, "dur": (n.findtext("type") or "?", len(n.findall("dot"))),
                        "lyric": norm_lyric(lyr), "measure": mi, "rawlyric": lyr})
    return out, part.get("id")


def align(a, b):
    """Edit-distance alignment; substitution cost favours same pitch."""
    n, m = len(a), len(b)
    INF = float("inf")
    D = [[INF] * (m + 1) for _ in range(n + 1)]
    P = [[None] * (m + 1) for _ in range(n + 1)]
    D[0][0] = 0
    for i in range(n + 1):
        for j in range(m + 1):
            if i < n and D[i][j] + 1 < D[i + 1][j]:
                D[i + 1][j], P[i + 1][j] = D[i][j] + 1, "del"
            if j < m and D[i][j] + 1 < D[i][j + 1]:
                D[i][j + 1], P[i][j + 1] = D[i][j] + 1, "ins"
            if i < n and j < m:
                c = 0 if a[i]["midi"] == b[j]["midi"] else (0.6 if a[i]["midi"] is not None and b[j]["midi"] is not None and (a[i]["midi"] - b[j]["midi"]) % 12 == 0 else 1.2)
                if D[i][j] + c < D[i + 1][j + 1]:
                    D[i + 1][j + 1], P[i + 1][j + 1] = D[i][j] + c, "sub"
    pairs, i, j = [], n, m
    while i or j:
        k = P[i][j]
        if k == "sub":
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif k == "del":
            pairs.append((i - 1, None)); i -= 1
        else:
            pairs.append((None, j - 1)); j -= 1
    return pairs[::-1]


def main():
    gt = load_gt(sys.argv[1])
    omr, pid = load_omr(sys.argv[2])
    verbose = "--verbose" in sys.argv
    pairs = align(gt, omr)
    matched = [(i, j) for i, j in pairs if i is not None and j is not None]
    pitch_ok = sum(gt[i]["midi"] == omr[j]["midi"] for i, j in matched)
    pc_ok = sum(gt[i]["midi"] is not None and (gt[i]["midi"] - omr[j]["midi"]) % 12 == 0 for i, j in matched)
    dur_ok = sum(gt[i]["dur"] == omr[j]["dur"] for i, j in matched)
    gt_lyr = [(i, j) for i, j in matched if gt[i]["lyric"]]
    lyr_ok = sum(gt[i]["lyric"] == omr[j]["lyric"] for i, j in gt_lyr)
    gt_lyr_total = sum(1 for g in gt if g["lyric"])
    res = {
        "file": sys.argv[2], "omrPart": pid,
        "gtNotes": len(gt), "omrNotes": len(omr), "matched": len(matched),
        "recall": round(len(matched) / max(1, len(gt)), 3),
        "precision": round(len(matched) / max(1, len(omr)), 3),
        "pitchExact": round(pitch_ok / max(1, len(gt)), 3),
        "pitchClass": round(pc_ok / max(1, len(gt)), 3),
        "rhythm": round(dur_ok / max(1, len(gt)), 3),
        "lyrics": round(lyr_ok / max(1, gt_lyr_total), 3),
        "gtLyrics": gt_lyr_total, "omrLyrics": sum(1 for o in omr if o["lyric"]),
    }
    print(json.dumps(res, indent=1))
    if verbose:
        for i, j in pairs:
            g = gt[i] if i is not None else None
            o = omr[j] if j is not None else None
            flag = ""
            if g and o:
                if g["midi"] != o["midi"]: flag += " PITCH"
                if g["dur"] != o["dur"]: flag += " DUR"
                if g["lyric"] and g["lyric"] != o["lyric"]: flag += " LYR"
            else:
                flag = " MISSING" if g else " EXTRA"
            print(f"{(g['measure'] if g else ''):>3} {(g['pitch'] if g else ''):>4} {str(g['dur'] if g else ''):16s} {(g['rawlyric'] if g else ''):10s} | "
                  f"{(o['measure'] if o else ''):>3} {(o['midi'] if o else ''):>4} {str(o['dur'] if o else ''):16s} {(o['rawlyric'] if o else ''):10s}{flag}")


if __name__ == "__main__":
    main()
