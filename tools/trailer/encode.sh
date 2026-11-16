#!/bin/bash
# Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
# Builds the ffmpeg job from the edit and encodes the trailer, all in containers. Run from the project
# folder on the host (Git Bash):  bash tools/trailer/encode.sh   (TRAILER_DRAFT=1 for a quick check)
set -euo pipefail
export MSYS_NO_PATHCONV=1
# The black frame the edit shows before and after the footage.
if [ ! -f .cache/trailer/black.jpg ]; then
  docker run --rm -v "$PWD:/work" -w /work mwader/static-ffmpeg:latest -y -loglevel error \
    -f lavfi -i color=black:s=1920x1080 -frames:v 1 -q:v 2 .cache/trailer/black.jpg
fi
docker run --rm -v "$PWD:/app" -w /app -e TRAILER_DRAFT="${TRAILER_DRAFT:-}" node:26-slim node tools/trailer/build.mjs
mapfile -t ARGS < <(tr -d '\r' < .cache/trailer/args.txt)
docker run --rm -v "$PWD:/work" -w /work mwader/static-ffmpeg:latest "${ARGS[@]}"
OUT=.cache/trailer/out/gen-worlds-trailer.mp4
if [ "${TRAILER_DRAFT:-}" = "1" ]; then OUT=.cache/trailer/out/gen-worlds-trailer-draft.mp4; fi
# A demuxing error ends the picture early without failing ffmpeg: check both streams run the full length.
docker run --rm --entrypoint /ffprobe -v "$PWD:/work" -w /work mwader/static-ffmpeg:latest -v error \
  -show_entries stream=codec_type,duration -of csv=p=0 "$OUT" | tr -d '\r' | while IFS=, read -r kind seconds; do
  echo "$kind: $seconds s"
  awk -v s="$seconds" 'BEGIN { exit !(s > 299) }' || { echo "the $kind stream is short" >&2; exit 1; }
done
ls -la .cache/trailer/out/
