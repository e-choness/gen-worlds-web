# Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
"""Times every lyric line of a sung take: Whisper transcribes the isolated vocals with word
timestamps, and the transcript is matched to the written lyrics word by word. The result says how
much of the lyrics a listener can make out (the share of words heard) and where each line is sung,
which the trailer's edit is cut to.

Runs in a Python container (the model is cached under .cache/):
  docker run --rm -v "$PWD:/app" -w /app -e HF_HOME=/app/.cache/hf python:3.12-slim \
    sh -c "pip install -q --cache-dir /app/.cache/pip faster-whisper soundfile && \
           python -I tools/trailer/align.py tools/trailer/lyrics.txt <vocals.wav> <out.json>"
"""

import difflib
import json
import re
import sys

import numpy as np
import soundfile
from faster_whisper import WhisperModel

RATE = 16_000


def load_audio(path: str) -> np.ndarray:
    """Mono float32 at 16 kHz (decoded here: faster-whisper's own loader breaks on new PyAV)."""
    samples, rate = soundfile.read(path, dtype="float32", always_2d=True)
    mono = samples.mean(axis=1)
    times = np.arange(0, len(mono) / rate, 1 / RATE)
    return np.interp(times, np.arange(len(mono)) / rate, mono).astype(np.float32)


def words_of(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower().replace("-", " "))


def read_lyrics(path: str) -> list[dict]:
    lines, section = [], None
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            text = raw.strip()
            if not text:
                continue
            tag = re.fullmatch(r"\[(\w+)\]", text)
            if tag:
                section = tag.group(1)
                continue
            lines.append({"section": section, "text": text, "words": words_of(text)})
    return lines


def main() -> None:
    lyrics_path, audio_path, out_path = sys.argv[1:4]
    lines = read_lyrics(lyrics_path)
    model = WhisperModel("large-v3", device="cpu", compute_type="int8", cpu_threads=16)
    segments, _ = model.transcribe(
        load_audio(audio_path), language="en", word_timestamps=True, vad_filter=False, beam_size=5,
        condition_on_previous_text=False,
    )
    heard = []
    for segment in segments:
        for word in segment.words or []:
            for token in words_of(word.word):
                heard.append({"w": token, "start": round(word.start, 3), "end": round(word.end, 3)})

    written = [(index, token) for index, line in enumerate(lines) for token in line["words"]]
    matcher = difflib.SequenceMatcher(
        a=[token for _, token in written], b=[item["w"] for item in heard], autojunk=False
    )
    timed: dict[int, list[tuple[float, float]]] = {}
    matched = 0
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            line_index = written[block.a + offset][0]
            item = heard[block.b + offset]
            timed.setdefault(line_index, []).append((item["start"], item["end"]))
            matched += 1

    out_lines = []
    for index, line in enumerate(lines):
        spans = timed.get(index, [])
        out_lines.append(
            {
                "section": line["section"],
                "text": line["text"],
                "heard": round(len(spans) / max(1, len(line["words"])), 2),
                "start": min((s for s, _ in spans), default=None),
                "end": max((e for _, e in spans), default=None),
            }
        )
    result = {
        "audio": audio_path,
        "intelligibility": round(matched / max(1, len(written)), 3),
        "transcript": " ".join(item["w"] for item in heard),
        "lines": out_lines,
        "words": heard,
    }
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=1)
    print(f"{audio_path}: {result['intelligibility'] * 100:.0f}% of the lyric words heard")
    for line in out_lines:
        start = "  -  " if line["start"] is None else f"{line['start']:6.1f}"
        print(f"{start} {line['heard']:.2f} [{line['section']}] {line['text']}")


if __name__ == "__main__":
    main()
