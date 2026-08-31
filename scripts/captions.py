"""Burned-in captions for the studio film.

Timings come from film/timeline.json — the same beats the voice was laid into —
so a caption is on screen for exactly as long as the sentence it belongs to, in
both cuts, without anyone typing a timecode.

One font for both languages: Noto Sans CJK carries Latin and Chinese, so the two
cuts look like the same film rather than two typesettings. The outline matters
more than it sounds — part one plays over bright landscapes and part two over a
dark ground, and white text has to survive both.

  python scripts/captions.py film/timeline.json film/script.json film
"""
import json, sys
from pathlib import Path

tl = json.loads(Path(sys.argv[1]).read_text())
sc = json.loads(Path(sys.argv[2]).read_text())
out = Path(sys.argv[3])
LINE = {b["id"]: b for b in sc["beats"]}
TAIL = 0.30                    # clear the caption before the next beat starts

HEAD = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Noto Sans CJK SC,{size},&H00FFFFFF,&H000000FF,&HC0100804,&H00000000,0,0,0,0,100,100,0,0,1,2.6,1.2,2,120,120,48,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def ts(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


# Nine fields declared against ten written put a stray comma at the head of
# every line — MarginV was missing from the Format above. Sizes are up from
# 30/32: at 1280x720 a caption has to be read at a glance, not studied.
for lang, size in (("en", 35), ("zh", 38)):
    rows = [HEAD.format(size=size)]
    for b in tl["beats"]:
        text = LINE[b["id"]][lang].replace("—", "—").strip()
        end = b["start"] + b["dur"] - TAIL
        rows.append(f"Dialogue: 0,{ts(b['start'])},{ts(end)},Cap,,0,0,0,,{text}")
    f = out / f"cap_{lang}.ass"
    f.write_text("\n".join(rows) + "\n")
    print(f"  {f}  {len(tl['beats'])} captions")
