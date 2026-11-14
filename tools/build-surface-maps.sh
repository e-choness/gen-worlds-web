#!/bin/sh
# Builds the real-body surface maps shipped in public/maps from NASA source data.
# Run in the GDAL container:  docker compose run --rm gdal sh tools/build-surface-maps.sh
#
# Moon: NASA SVS "CGI Moon Kit" (https://svs.gsfc.nasa.gov/4720/), public domain.
#   - colour: LROC WAC mosaic, 4096 x 2048, equirectangular, longitude 0 at the image centre
#   - height: LOLA gridded elevation, 16 px/degree, unsigned 16-bit half-metres offset by +20000,
#     relative to a sphere of radius 1737.4 km
# Output heights are raw little-endian signed 16-bit metres relative to 1737.4 km, row 0 at the
# north pole, column 0 at longitude -180: see src/data/surface_maps.json.
set -eu

SRC=https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720
DL=.cache/downloads/moon
OUT=public/maps
mkdir -p "$DL" "$OUT"

for file in lroc_color_poles_4k.tif ldem_16_uint.tif; do
  if [ ! -s "$DL/$file" ]; then
    echo "downloading $file"
    wget -q -O "$DL/$file" "$SRC/$file"
  fi
done

# Colour: straight to JPEG.
gdal_translate -q -of JPEG -co QUALITY=88 "$DL/lroc_color_poles_4k.tif" "$OUT/moon_albedo_4k.jpg"
rm -f "$OUT/moon_albedo_4k.jpg.aux.xml"

# Height: average down to 8 px/degree and convert half-metres+20000 to signed metres.
gdal_translate -q -of ENVI -ot Int16 -outsize 2880 1440 -r average \
  -scale 0 40000 -10000 10000 "$DL/ldem_16_uint.tif" "$DL/moon_height.img"
cp "$DL/moon_height.img" "$OUT/moon_height_2880x1440.i16"

ls -l "$OUT"
