# Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
"""Finds where the trailer can jump inside the narration song without the cut being heard.

The trailer's music is one song: three sung parts, with the song's own instrumental stem playing
between them (the vocals and instrumental come from SongForge's Demucs split). Each instrumental
passage starts where the sung part stopped, so its first join is seamless by construction. Its
last join jumps back to where the next sung part starts, and that jump is chosen here: the music
leading into the jump and following it must match the music around the landing point in harmony
(chroma) and rhythm (onsets), to within a few milliseconds.

Prints the best jumps for each passage and the song's loudness at the end (the trailer opens on
the song's own ending). Run in a Python container (see align.py for the cache settings):
    python -I tools/trailer/joins.py <instrumental.wav>
"""

import sys

import librosa
import numpy as np

RATE = 22050
COARSE = 512  # analysis hop for the search, samples (23 ms)
FINE = 64  # hop for the final alignment, samples (2.9 ms)
WINDOW = 3.4  # seconds compared on each side of a join: two sung lines, about 8 beats

# Each passage: where its sung part may end (the instrumental takes over there), where the next
# sung part may begin, and the passage lengths that fit the picture. Song seconds; the ranges
# sit in the vocal gaps found by align.py.
PASSAGES = {
    "launch": {"land": (109.2, 110.55), "length": (28.0, 37.0)},
    "worlds": {"leave": 170.6, "land": (170.2, 175.6), "length": (22.0, 32.0)},
}


def load(path: str) -> np.ndarray:
    samples, _ = librosa.load(path, sr=RATE, mono=True)
    return samples


def features(samples: np.ndarray, hop: int) -> tuple[np.ndarray, np.ndarray]:
    """Unit chroma vectors and a standardised onset envelope, one column per hop."""
    chroma = librosa.feature.chroma_cqt(y=samples, sr=RATE, hop_length=hop)
    onset = librosa.onset.onset_strength(y=samples, sr=RATE, hop_length=hop)
    n = min(chroma.shape[1], len(onset))
    chroma = chroma[:, :n] / (np.linalg.norm(chroma[:, :n], axis=0, keepdims=True) + 1e-9)
    onset = (onset[:n] - onset[:n].mean()) / (onset[:n].std() + 1e-9)
    return chroma, onset


def alike(chroma: np.ndarray, onset: np.ndarray, a: int, b: int, w: int) -> tuple[float, float]:
    """Harmony (mean chroma cosine) and rhythm (onset correlation) of frames a.. against b.."""
    harmony = float((chroma[:, a : a + w] * chroma[:, b : b + w]).sum(axis=0).mean())
    oa, ob = onset[a : a + w], onset[b : b + w]
    rhythm = float(np.dot(oa, ob) / (np.linalg.norm(oa) * np.linalg.norm(ob) + 1e-9))
    return harmony, rhythm


def seam(chroma: np.ndarray, onset: np.ndarray, leave: int, land: int, w: int) -> tuple[float, float]:
    """A jump from frame `leave` to frame `land` is unheard when what led into each matches and
    what follows each matches."""
    before = alike(chroma, onset, leave - w, land - w, w)
    after = alike(chroma, onset, leave, land, w)
    return (before[0] + after[0]) / 2, (before[1] + after[1]) / 2


def search(chroma, onset, leaves, lands, w):
    best = []
    for land in lands:
        for leave in leaves:
            harmony, rhythm = seam(chroma, onset, leave, land, w)
            best.append((harmony + rhythm, harmony, rhythm, leave, land))
    best.sort(reverse=True)
    # Keep candidates at least half a second apart, so the list shows real alternatives.
    picked = []
    for item in best:
        if all(abs(item[3] - p[3]) > 0.5 * RATE / COARSE for p in picked):
            picked.append(item)
        if len(picked) == 6:
            break
    return picked


def refine(onset_fine: np.ndarray, leave_s: float, land_s: float) -> float:
    """Moves the leave point by up to ±40 ms so the onsets on both sides line up exactly."""
    w = int(WINDOW * RATE / FINE)
    land = int(round(land_s * RATE / FINE))
    centre = int(round(leave_s * RATE / FINE))
    reach = int(0.04 * RATE / FINE)
    scores = []
    for leave in range(centre - reach, centre + reach + 1):
        a = onset_fine[leave - w : leave + w]
        b = onset_fine[land - w : land + w]
        scores.append((float(np.dot(a, b)), leave))
    return max(scores)[1] * FINE / RATE


def main(path: str) -> None:
    samples = load(path)
    chroma, onset = features(samples, COARSE)
    _, onset_fine = features(samples, FINE)
    frame = lambda s: int(round(s * RATE / COARSE))  # noqa: E731
    seconds = lambda f: f * COARSE / RATE  # noqa: E731
    w = frame(WINDOW)
    for name, spec in PASSAGES.items():
        lands = range(frame(spec["land"][0]), frame(spec["land"][1]) + 1)
        start = spec.get("leave")
        lo, hi = spec["length"]
        if start is None:
            # The instrumental starts where the sung part stops, at the landing point itself.
            leaves = range(frame(spec["land"][0] + lo), frame(spec["land"][1] + hi) + 1)
        else:
            leaves = range(frame(start + lo), frame(start + hi) + 1)
        print(f"# {name}")
        for total, harmony, rhythm, leave, land in search(chroma, onset, leaves, lands, w):
            leave_s = refine(onset_fine, seconds(leave), seconds(land))
            print(
                f"  leave {leave_s:8.3f}  land {seconds(land):8.3f}  jump {leave_s - seconds(land):7.3f} s"
                f"  harmony {harmony:.3f}  rhythm {rhythm:.3f}  score {total:.3f}"
            )
    rms = librosa.feature.rms(y=samples, hop_length=RATE // 2)[0]
    tail = [f"{i * 0.5:.1f}:{20 * np.log10(v + 1e-9):.0f}" for i, v in enumerate(rms) if i * 0.5 >= 185]
    print("# loudness of the ending, dB per half second")
    print("  " + " ".join(tail))


if __name__ == "__main__":
    main(sys.argv[1])
