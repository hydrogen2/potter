"""One timeline, two voices.

The pictures are identical in both cuts, so the beats must land at the same
times in both — otherwise they are two different films. Each beat is given the
longer of the two readings plus a breath, and the shorter language is padded
into it. English and Mandarin then differ inside a beat and agree at every
boundary.

  python scripts/vo-timeline.py film/vo film/script.json
"""
import json, sys
from pathlib import Path
import numpy as np, soundfile as sf

vo = Path(sys.argv[1])
man = json.loads((vo / "manifest.json").read_text())
GAP = 0.45                      # breath between beats
LEAD = 0.6                      # a moment before the first word
SR = 24000

# --keep reuses the timeline that is already there. Re-voicing one language must
# not move the pictures: the frames were rendered to these beats, and a beat that
# shifts by a tenth of a second would need the whole film again for nothing.
KEEP = "--keep" in sys.argv and (vo.parent / "timeline.json").exists()
if KEEP:
    old = json.loads((vo.parent / "timeline.json").read_text())
    beats, total = old["beats"], old["total"]
    for b in beats:
        for lang in ("en", "zh"):
            d = next(r for r in man[lang] if r["id"] == b["id"])["dur"]
            if d > b["dur"]:
                raise SystemExit(f"{b['id']} {lang} is now {d:.2f}s, longer than "
                                 f"its {b['dur']:.2f}s beat — the timeline must be rebuilt")
    print(f"  keeping the existing timeline: {len(beats)} beats, {total:.2f}s")
else:
    ids = [r["id"] for r in man["en"]]
    beats = []
    t = LEAD
    for i, bid in enumerate(ids):
        d = max(next(r for r in man[l] if r["id"] == bid)["dur"] for l in ("en", "zh"))
        beats.append({"id": bid, "start": round(t, 3), "dur": round(d + GAP, 3),
                      "part": next(r for r in man["en"] if r["id"] == bid)["part"]})
        t += d + GAP
    total = round(t + 0.7, 3)       # a beat of silence to end on

for lang in ("en", "zh"):
    track = np.zeros(int(total * SR), dtype=np.float32)
    for b in beats:
        row = next(r for r in man[lang] if r["id"] == b["id"])
        s, sr = sf.read(str(vo / row["file"]), dtype="float32")
        if sr != SR:
            raise SystemExit(f"unexpected sample rate {sr}")
        if s.ndim > 1:
            s = s.mean(axis=1)
        i0 = int(b["start"] * SR)
        track[i0:i0 + len(s)] += s[: len(track) - i0]
    peak = float(np.abs(track).max()) or 1.0
    sf.write(str(vo.parent / f"vo_{lang}.wav"), track * (0.89 / peak), SR)
    print(f"  vo_{lang}.wav  {total:.2f}s")

if not KEEP:
    (vo.parent / "timeline.json").write_text(json.dumps(
        {"total": total, "fps": 12, "beats": beats}, indent=2))
print(f"  timeline: {len(beats)} beats, {total:.1f}s, {int(total*12)} frames at 12fps")
for b in beats:
    print(f"    {b['id']:4} part{b['part']}  {b['start']:6.2f} +{b['dur']:5.2f}")
