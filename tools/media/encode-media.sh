#!/bin/sh
# Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
# Encodes the media kit's GIFs and MP4 with ffmpeg in a container, from the frames left in .cache/ by
# tools/media/build-media-kit.mjs (banner) and tools/record-video.mjs (gameplay). Run from the
# project folder on the host (Git Bash: prefix with MSYS_NO_PATHCONV=1):
#   sh tools/media/encode-media.sh
set -e
FF="docker run --rm -v $(pwd):/work -w /work mwader/static-ffmpeg:latest -y -loglevel error"

# Banner: one 12 s loop at 15 fps.
$FF -framerate 15 -i .cache/media/banner-frames/%04d.png \
  -vf "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a" \
  -loop 0 media/banners/banner-animated.gif

# Gameplay: the 3D stage cut from the demo video's flight (frames 340 to 724), as a GIF and an MP4.
STAGE="crop=836:288:50:358"
$FF -framerate 30 -start_number 340 -t 12.8 -i .cache/video/frames/%04d.jpg \
  -vf "$STAGE,fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 media/gameplay-flight.gif
$FF -framerate 30 -start_number 340 -t 12.8 -i .cache/video/frames/%04d.jpg \
  -vf "$STAGE,scale=1672:576:flags=lanczos,format=yuv420p" -c:v libx264 -crf 20 -preset slow \
  -movflags +faststart media/gameplay-flight.mp4

# The demo video itself.
$FF -framerate 30 -i .cache/video/frames/%04d.jpg -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -movflags +faststart public/gen-worlds-demo.mp4
