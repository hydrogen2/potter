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
# Split on SENTENCES only. Splitting on clauses as well hands Kokoro fragments
# to voice as whole utterances, and a fragment gets a whole utterance's contour:
# "茶，", one syllable, came out as a 0.60s clip with a terminal fall on it, so a
# rising 茶 was heard as a fourth tone. Kokoro phrases on the punctuation inside
# the phoneme string by itself — measured, a comma and a colon each produce their
# own pause — so the clause breaks were never needed for phrasing, only the
# sentence gaps are ours to insert.
# A semicolon is NOT a sentence end in Chinese, it is a heavy comma joining two
# halves of one thought. Splitting there made 壶肩 utterance-final, and a level
# first tone at the end of an utterance takes the terminal fall with it, so 肩
# was heard as a fourth.
ZH_SENT, ZH_CLAUSE = set("。！？.!?"), set()
PAUSE = {"s": 0.26, "c": 0.13}
# Below this many characters a chunk is a fragment, not a sentence, and gets
# merged into its neighbour. "陶，器。" is a sentence by punctuation and a
# two-syllable fragment by ear; voiced alone it lost 陶's rising tone the same
# way "茶，" did.
MIN_CHARS = 4

TONES = "↓↗→↘"
_PUNCT = set(",.;:!?，。；：！？")


def third_tone_sandhi(ipa: str) -> str:
    """A third tone before another third tone is said as a rising tone.

    misaki's default frontend does not do this — 你好 comes out ni↓xau↓ when
    every speaker says ni↗xau↓ — and pypinyin's own tone_sandhi only catches
    dictionary words, so 很好, 水果 and 每把 all come through unchanged. It is
    the single most audible thing wrong with the Mandarin: a native ear hears a
    stack of full third tones immediately, and the script here has 每把, 有两,
    已有 and 与口 in it.

    Applied pairwise over consecutive tone marks, so a run of n becomes
    rising-rising-...-third. Two guards: never across punctuation, because
    sandhi does not cross a pause; and never across an intervening toneless
    syllable, which is what the gap limits are for — 'wo↓ tɤ xau↓' (我的好) must
    be left alone while 'xə↓n xau↓' (很好) must not.
    """
    out = list(ipa)
    marks = [i for i, c in enumerate(out) if c in TONES]
    for a, b in zip(marks, marks[1:]):
        if out[a] != "↓" or out[b] != "↓":
            continue
        gap = ipa[a + 1:b]
        if any(c in _PUNCT for c in gap):
            continue
        if gap.count(" ") > 1 or len(gap) > 5:
            continue                       # a whole syllable sits between them
        out[a] = "↗"
    return "".join(out)

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
    n = lambda t: len(re.findall(r"[\u4e00-\u9fff]", t))
    merged = []
    for seg, kind in out:
        if merged and n(seg) < MIN_CHARS:
            merged[-1] = (merged[-1][0] + seg, kind)
        else:
            merged.append((seg, kind))
    if len(merged) > 1 and n(merged[0][0]) < MIN_CHARS:   # a short opener merges forward
        merged[1] = (merged[0][0] + merged[1][0], merged[1][1])
        merged.pop(0)
    return merged


def unglue(text):
    """Force a word boundary wherever jieba's HMM has invented a word.

    jieba cuts 另一面/是业 — 是业 is not a word, it is the copula stuck onto the
    noun behind it, and misaki then emits ʂɨ↘je↘ as a single word, which Kokoro
    voices as a trochee: second syllable unstressed, its fourth tone flattened.
    The same line's 是亚 is cut 是/亚 and comes out right, which is why only one
    of the pair sounded wrong.

    A token absent from jieba's dictionary was assembled by its new-word HMM
    rather than looked up, and that is precisely the class to distrust. Real
    entries are left alone: 不必, 就是 and 作工 all appear in this script and all
    have dictionary frequencies.
    """
    import jieba
    jieba.initialize()
    for tok in jieba.cut(text):
        if len(tok) > 1 and not jieba.dt.FREQ.get(tok):
            jieba.suggest_freq(tuple(tok), True)


def synth(text, lang):
    eng = engine()
    if lang == "zh":
        g2p = zh_g2p()
        segs = [(s, k) for s, k in chunks(text)
                if re.search(r"[一-鿿0-9A-Za-z]", s)]
        parts, sr = [], 24000
        for n, (seg, kind) in enumerate(segs):
            ph, _ = g2p(seg)
            ph = third_tone_sandhi(ph)
            s, sr = eng.create(ph, voice=VOICE["zh"], speed=SPEED["zh"], is_phonemes=True)
            parts.append(s)
            if n < len(segs) - 1:                 # gaps between, never trailing
                parts.append(np.zeros(int(PAUSE[kind] * sr), dtype=s.dtype))
        return np.concatenate(parts), sr
    return eng.create(text, voice=VOICE["en"], speed=SPEED["en"], lang="en-us")


def main():
    script = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    for b in script["beats"]:            # tune jieba before the G2P is built
        unglue(b["zh"])
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
