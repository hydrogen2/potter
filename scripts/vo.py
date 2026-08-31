"""Voice-over for the studio film, in English and Mandarin.

Kokoro runs locally (Apache-2.0, 82M params, CPU), so retakes are free — the
model and voices are the ones already sitting in ../hilbert/models/kokoro.

Mandarin does NOT go through kokoro-onnx's own text path: that phonemizes with
espeak-ng, which its docstring scopes to en-us/en-gb, and pushing Chinese
through it drops the tone contours entirely. misaki emits properly toned IPA
and we hand Kokoro the phonemes directly. The same trap, and the same fix, as
hilbert/studio/tts.py.

  uv run --with kokoro-onnx --with misaki --with soundfile --with numpy \
     python scripts/vo.py film/script.json film/vo
"""
import json, re, sys
from pathlib import Path

import numpy as np
import soundfile as sf

MODEL = Path.home() / "hilbert/models/kokoro"
VOICE = {"en": "af_heart", "zh": "zf_xiaoxiao"}
# A film is not learning material: hilbert slows English to 0.85 so a
# non-native listener can follow. Here it can move.
SPEED = {"en": 0.95, "zh": 1.0}
ZH_SENT, ZH_CLAUSE = set("。！？；.!?;"), set("，、：,:")
PAUSE = {"s": 0.26, "c": 0.13}

_eng = _g2p = None


def engine():
    global _eng
    if _eng is None:
        from kokoro_onnx import Kokoro
        _eng = Kokoro(str(MODEL / "kokoro-v1.0.onnx"), str(MODEL / "voices-v1.0.bin"))
    return _eng


def zh_g2p():
    global _g2p
    if _g2p is None:
        from misaki import zh
        _g2p = zh.ZHG2P()
    return _g2p


def chunks(text):
    out, cur = [], ""
    for ch in text:
        cur += ch
        if ch in ZH_SENT:
            out.append((cur, "s")); cur = ""
        elif ch in ZH_CLAUSE:
            out.append((cur, "c")); cur = ""
    if cur.strip():
        out.append((cur, "s"))
    return out


def synth(text, lang):
    eng = engine()
    if lang == "zh":
        g2p = zh_g2p()
        segs = [(s, k) for s, k in chunks(text)
                if re.search(r"[一-鿿0-9A-Za-z]", s)]
        parts, sr = [], 24000
        for n, (seg, kind) in enumerate(segs):
            ph, _ = g2p(seg)
            s, sr = eng.create(ph, voice=VOICE["zh"], speed=SPEED["zh"], is_phonemes=True)
            parts.append(s)
            if n < len(segs) - 1:                 # gaps between, never trailing
                parts.append(np.zeros(int(PAUSE[kind] * sr), dtype=s.dtype))
        return np.concatenate(parts), sr
    return eng.create(text, voice=VOICE["en"], speed=SPEED["en"], lang="en-us")


def main():
    script = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for lang in ("en", "zh"):
        rows = []
        for b in script["beats"]:
            samples, sr = synth(b[lang], lang)
            f = out / f"{b['id']}_{lang}.wav"
            sf.write(str(f), samples, sr)
            dur = len(samples) / sr
            rows.append({"id": b["id"], "part": b["part"], "dur": round(dur, 3),
                         "file": f.name})
            print(f"  {b['id']:4} {lang}  {dur:5.2f}s  {b[lang][:44]}")
        manifest[lang] = rows
        print(f"  --- {lang} total {sum(r['dur'] for r in rows):.1f}s")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))


main()
