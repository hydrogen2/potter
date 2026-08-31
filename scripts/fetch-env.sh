#!/usr/bin/env bash
# Backdrop HDRIs for the studio film. CC0 from Poly Haven, fetched rather than
# committed: six 2k maps are 36MB, which is a third of this repo again for
# third-party files that a stable URL reproduces exactly. The site does not need
# them — only filming does, and the finished films are committed.
#
#   bash scripts/fetch-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/scenes/_env
for s in valley_of_desolation blouberg_sunrise_1 alps_field birchwood goegap blue_grotto; do
  f="public/scenes/_env/${s}.hdr"
  [ -s "$f" ] && { echo "  have $s"; continue; }
  curl -fL --retry 3 "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${s}_2k.hdr" -o "$f"
  echo "  got  $s  $(du -h "$f" | cut -f1)"
done
