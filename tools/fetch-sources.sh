#!/bin/sh
# Fetch the upstream texts the importers read, sparse and shallow, into
# $TTRPG_SOURCES (default ~/.cache/ttrpg-sources). Each <name>.rev records the
# commit; bundles record it as their provenance. Text only: no images are used.
set -e
S="${TTRPG_SOURCES:-$HOME/.cache/ttrpg-sources}"
mkdir -p "$S"
fetch() { # name url branch sparse-dir
  rm -rf "$S/$1"
  if [ -n "$4" ]; then
    git clone -q --depth 1 --filter=blob:none --sparse ${3:+--branch "$3"} "$2" "$S/$1"
    git -C "$S/$1" sparse-checkout set "$4"
  else
    git clone -q --depth 1 ${3:+--branch "$3"} "$2" "$S/$1"
  fi
  git -C "$S/$1" rev-parse HEAD > "$S/$1.rev"
  echo "$1 $(cat "$S/$1.rev")"
}
fetch dnd5e https://github.com/foundryvtt/dnd5e.git 6.0.x packs/_source
fetch datasworn https://github.com/rsek/datasworn.git "" datasworn/starforged
fetch cairn https://github.com/yochaigal/cairn.git "" second-edition
fetch blades https://github.com/amazingrando/blades-in-the-dark-srd-content.git "" ""
