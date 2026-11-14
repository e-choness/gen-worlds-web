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

# Mars: USGS Astrogeology global mosaics (public domain).
#   - colour: Viking MDIM 2.1 colour mosaic, 232 m/px (12 GB): only every 22nd row and column is read
#     over HTTP, which is the nearest-neighbour 4096 x 2048 reduction
#   - height: MGS MOLA elevation, 463 m/px, signed 16-bit metres relative to a 3396.19 km sphere,
#     reduced the same way to 2880 x 1440
# Both are equirectangular with longitude 0 at the centre.
MARS=https://planetarymaps.usgs.gov/mosaic
DL=.cache/downloads/mars
mkdir -p "$DL"
export GDAL_HTTP_MAX_RETRY=20 GDAL_HTTP_RETRY_DELAY=3
if [ ! -s "$DL/mola_2880.tif" ]; then
  echo "reading MOLA elevation (slow: a range request per row)"
  gdal_translate -q -of GTiff -outsize 2880 1440 -r nearest \
    "/vsicurl/$MARS/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif" "$DL/mola_2880.tif"
fi
if [ ! -s "$DL/viking_4k.tif" ]; then
  echo "reading Viking colour (slow: a range request per row)"
  gdal_translate -q -of GTiff -outsize 4096 2048 -r nearest \
    "/vsicurl/$MARS/Mars_Viking_MDIM21_ClrMosaic_global_232m.tif" "$DL/viking_4k.tif"
fi
gdal_translate -q -of JPEG -co QUALITY=88 "$DL/viking_4k.tif" "$OUT/mars_albedo_4k.jpg"
rm -f "$OUT/mars_albedo_4k.jpg.aux.xml"
gdal_translate -q -of ENVI -ot Int16 "$DL/mola_2880.tif" "$DL/mars_height.img"
cp "$DL/mars_height.img" "$OUT/mars_height_2880x1440.i16"

# Earth:
#   - colour: NASA Blue Marble Next Generation, cloud-free, served by NASA GIBS as a 4096 x 2048
#     equirectangular image (https://gibs.earthdata.nasa.gov), public domain
#   - height: NOAA NCEI ETOPO 2022, one arc-minute ice-surface elevation and ocean depth in metres
#     relative to sea level (public domain, doi:10.25921/fd45-gt74), averaged to 8 px/degree
DL=.cache/downloads/earth
mkdir -p "$DL"
if [ ! -s "$DL/bmng_gibs.jpg" ]; then
  wget -q -O "$DL/bmng_gibs.jpg" "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=BlueMarble_NextGeneration&STYLES=&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=4096&HEIGHT=2048&FORMAT=image/jpeg"
fi
if [ ! -s "$DL/etopo_60s.tif" ]; then
  echo "downloading ETOPO 2022 (about 470 MB)"
  wget -q -O "$DL/etopo_60s.tif" \
    https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif
fi
cp "$DL/bmng_gibs.jpg" "$OUT/earth_albedo_4k.jpg"
gdal_translate -q -of ENVI -ot Int16 -outsize 2880 1440 -r average "$DL/etopo_60s.tif" "$DL/earth_height.img"
cp "$DL/earth_height.img" "$OUT/earth_height_2880x1440.i16"

ls -l "$OUT"
