#!/usr/bin/env python3
"""Narrate a beat script with Kokoro (kokoro-onnx) and emit exact cue times for HyperFrames.

Script format (one beat per line, '#' comments allowed):
    vo1|Drive a qubit with a [drive]resonant microwave, and it does [jump]not simply jump.
    vo2|Instead, it [osc]swings back and forth between ground and excited.

A [cue] marker names the moment the NEXT word starts. The beat is synthesised in
fragments split at the markers, the fragments are joined, and each cue time is the
exact sum of the audio before it, so no aligner model is needed.

Outputs (in the HyperFrames project):
    assets/voice/<beat>.wav   one loudness-normalised clip per beat
    assets/cues.js            window.CUES = {beat starts/ends + every [cue], in root seconds}
    narration.json            the same data plus text, for review
and prints the <audio> tags to paste into index.html.
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

SR_OUT = 48000
MARK = re.compile(r"\[([A-Za-z][\w-]*)\]")


def trim(x, sr, thresh_db=-45.0, keep=0.03):
    """Trim leading/trailing silence, keeping `keep` seconds of margin."""
    if len(x) == 0:
        return x
    thr = 10 ** (thresh_db / 20) * max(1e-9, float(np.max(np.abs(x))))
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x[:0]
    a = max(0, idx[0] - int(keep * sr))
    b = min(len(x), idx[-1] + int(keep * sr))
    return x[a:b]


def pause_after(text):
    t = text.rstrip()
    if not t:
        return 0.0
    if t[-1] in ".!?":
        return 0.30
    if t[-1] in ":;":
        return 0.22
    if t[-1] in ",—–-":
        return 0.14
    return 0.02  # mid-sentence split: keep the words joined


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("script", help="beat script file (id|text with [cue] markers)")
    ap.add_argument("--project", required=True, help="HyperFrames project directory")
    ap.add_argument("--model", required=True, help="kokoro-v1.0(.int8).onnx")
    ap.add_argument("--voices", required=True, help="voices-v1.0.bin")
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--lang", default="en-us")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--start", type=float, default=0.6, help="first beat start (s)")
    ap.add_argument("--gap", type=float, default=0.45, help="silence between beats (s)")
    ap.add_argument("--tail", type=float, default=2.8, help="hold after last beat (s)")
    a = ap.parse_args()

    proj = Path(a.project)
    vdir = proj / "assets" / "voice"
    vdir.mkdir(parents=True, exist_ok=True)
    k = Kokoro(a.model, a.voices)

    beats = []
    for raw in Path(a.script).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        bid, text = line.split("|", 1)
        beats.append((bid.strip(), text.strip()))

    cues, report, t = {}, [], a.start
    for bid, text in beats:
        # split into fragments; each fragment remembers the cue that starts it
        parts, last, cue = [], 0, None
        for m in MARK.finditer(text):
            frag = text[last:m.start()]
            if frag.strip():
                parts.append((cue, frag.strip()))
                cue = None
            if cue is not None:
                sys.exit(f"{bid}: two markers with no words between them")
            cue = m.group(1)
            last = m.end()
        parts.append((cue, text[last:].strip()))

        audio, offs, sr = [], {}, None
        for i, (c, frag) in enumerate(parts):
            if not frag:
                continue
            x, sr = k.create(frag, voice=a.voice, speed=a.speed, lang=a.lang)
            x = trim(np.asarray(x, dtype=np.float32), sr)
            if c:
                if c in cues or c in offs:
                    sys.exit(f"duplicate cue name: {c}")
                offs[c] = sum(len(s) for s in audio) / sr
            audio.append(x)
            gap = pause_after(frag) if i < len(parts) - 1 else 0.0
            audio.append(np.zeros(int(gap * sr), dtype=np.float32))
        y = np.concatenate(audio)
        rawp = vdir / f"{bid}.raw.wav"
        sf.write(rawp, y, sr)
        out = vdir / f"{bid}.wav"
        subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(rawp),
                        "-af", "loudnorm=I=-16:TP=-1.5:LRA=7", "-ar", str(SR_OUT), str(out)],
                       check=True, stdin=subprocess.DEVNULL)
        rawp.unlink()
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                    "-of", "csv=p=0", str(out)], capture_output=True, text=True,
                                   check=True).stdout)
        cues[f"{bid}_start"] = round(t, 3)
        cues[f"{bid}_end"] = round(t + dur, 3)
        for c, o in offs.items():
            cues[c] = round(t + o, 3)
        report.append({"id": bid, "start": round(t, 3), "duration": round(dur, 3),
                       "text": MARK.sub("", text), "cues": {c: round(t + o, 3) for c, o in offs.items()}})
        t += dur + a.gap

    total = round(t - a.gap + a.tail, 2)
    cues["total"] = total
    (proj / "assets" / "cues.js").write_text(
        "// generated by narrate.py — do not edit by hand; re-run after changing the script\n"
        f"window.CUES = {json.dumps(cues, indent=2)};\n", encoding="utf-8")
    (proj / "narration.json").write_text(json.dumps({"total": total, "beats": report}, indent=2))

    print(f"total duration: {total} s  (set root and scene-host data-duration to this)\n")
    for b in report:
        print(f'<audio id="{b["id"]}" class="clip" src="assets/voice/{b["id"]}.wav" '
              f'data-start="{b["start"]}" data-duration="{b["duration"]}" '
              f'data-track-index="2" data-volume="1"></audio>')
    print("\ncues:", json.dumps({k_: v for k_, v in cues.items()}, indent=None))


if __name__ == "__main__":
    main()
