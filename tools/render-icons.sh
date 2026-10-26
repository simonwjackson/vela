#! /usr/bin/env nix
#! nix shell --inputs-from .. nixpkgs#bash nixpkgs#resvg nixpkgs#imagemagick nixpkgs#oxipng --command bash
# shellcheck shell=bash
#
# Vela's brand mark and every icon file made from it. The mark is defined once, here.
#
#   tools/render-icons.sh              write the SVGs and PNGs into public/
#   tools/render-icons.sh --preview D  also write preview sheets into D (not committed)
#
# The mark: two sails ("vela" is Latin for sail), each one closed stroke in the Signal glyph hand
# (24 grid, round caps and joins). The main sail is t1; the jib is t2, one grey tier down. No
# accent: the accent belongs to the app's three uses. The ground is the app's --bg, #08090a.
#
# Outputs (public/):
#   icon.svg                 the mark on its tile; manifest "any", and the favicon for large sizes
#   favicon.svg              the same, heavier, filling more of the tile: tab and bookmark sizes
#   favicon.ico              16, 32 and 48 from favicon.svg, for clients without SVG icons
#   icons/icon-192.png       manifest "any"
#   icons/icon-512.png       manifest "any"
#   icons/maskable-512.png   manifest "maskable": full bleed, the mark inside the 80% safe circle
#   apple-touch-icon.png     180, full bleed (iOS rounds the corners itself)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/../public"
preview=""
if [[ "${1:-}" == "--preview" ]]; then preview="${2:?--preview needs a directory}"; fi

BG="#08090a"
T1="#f7f8f8"
T2="#8a8f98"
EDGE_OPACITY=".09"

# The two sails on the 24 grid, centred on (12, 12) with the stroke included.
MAIN="M12.65 3.7c4 3.7 6.2 9.4 6.6 16H12.65z"
JIB="M9.65 7.2c-2.4 3.3-4.2 7.6-4.9 12.5h4.9z"
# Small sizes: a heavier stroke, and the sails moved apart so the gap survives at 16 px.
MAIN_SMALL="M12.95 3.9c4 3.7 6 9.3 6.4 15.6H12.95z"
JIB_SMALL="M9.35 7.4c-2.3 3.2-4 7.4-4.7 12.1h4.7z"

# mark SCALE STROKE MAIN JIB: the mark, drawn on a 512 canvas, centred.
mark() {
  cat <<SVG
<g transform="translate(256 256) scale($1) translate(-12 -12)" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="$2">
<path stroke="$T2" d="$4"/>
<path stroke="$T1" d="$3"/>
</g>
SVG
}

# tile: the rounded ground with a hairline edge, for icons the platform does not mask.
tile() {
  cat <<SVG
<rect width="512" height="512" rx="$1" fill="$BG"/>
<rect x="1.5" y="1.5" width="509" height="509" rx="$(( $1 - 1 ))" fill="none" stroke="#fff" stroke-opacity="$EDGE_OPACITY" stroke-width="3"/>
SVG
}

svg() {
  printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n%s\n</svg>\n' "$1"
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$out/icons"

# Manifest "any": the mark at about half the tile's height.
svg "<title>Vela</title>
$(tile 112)
$(mark 14.5 2 "$MAIN" "$JIB")" > "$out/icon.svg"

# Tab sizes: the mark fills two thirds of the tile, with a heavier stroke.
svg "<title>Vela</title>
$(tile 96)
$(mark 19 2.6 "$MAIN_SMALL" "$JIB_SMALL")" > "$out/favicon.svg"

# Maskable: full bleed. The mark's farthest corner is about 33% of the width from the centre,
# inside the 40% safe radius and inside the smallest Android mask.
svg "<rect width=\"512\" height=\"512\" fill=\"$BG\"/>
$(mark 11 2 "$MAIN" "$JIB")" > "$work/maskable.svg"

# Apple touch icon: full bleed; iOS draws its own corners.
svg "<rect width=\"512\" height=\"512\" fill=\"$BG\"/>
$(mark 14.5 2 "$MAIN" "$JIB")" > "$work/apple.svg"

resvg -w 192 -h 192 "$out/icon.svg" "$out/icons/icon-192.png"
resvg -w 512 -h 512 "$out/icon.svg" "$out/icons/icon-512.png"
resvg -w 512 -h 512 "$work/maskable.svg" "$out/icons/maskable-512.png"
resvg -w 180 -h 180 "$work/apple.svg" "$out/apple-touch-icon.png"
for s in 16 32 48; do resvg -w "$s" -h "$s" "$out/favicon.svg" "$work/fav-$s.png"; done
magick "$work/fav-16.png" "$work/fav-32.png" "$work/fav-48.png" "$out/favicon.ico"

# The apple icon must be opaque (iOS fills transparency with black, Android launchers with white).
magick "$out/apple-touch-icon.png" -background "$BG" -alpha remove -alpha off "$out/apple-touch-icon.png"
magick "$out/icons/maskable-512.png" -background "$BG" -alpha remove -alpha off "$out/icons/maskable-512.png"
oxipng --quiet --strip safe -o 4 "$out/icons/"*.png "$out/apple-touch-icon.png"

if [[ -n "$preview" ]]; then
  mkdir -p "$preview"
  # Each size as a launcher shows it: "any" on its tile, and the maskable cut to its 80% safe
  # circle (every launcher mask shows at least that much).
  for s in 48 96 192; do
    resvg -w "$s" -h "$s" "$out/icon.svg" "$work/any-$s.png"
    big=$(( s * 5 / 4 ))
    resvg -w "$big" -h "$big" "$work/maskable.svg" "$work/mask-$s.png"
    magick "$work/mask-$s.png" -gravity center -crop "${s}x${s}+0+0" +repage \( -size "${s}x${s}" xc:none -fill white -draw "circle $((s / 2)),$((s / 2)) $((s / 2)),0" \) \
      -compose DstIn -composite "$work/round-$s.png"
  done
  for s in 16 32; do resvg -w "$s" -h "$s" "$out/favicon.svg" "$work/fav-$s.png"; done
  for ground in dark light; do
    if [[ $ground == dark ]]; then bg="#1b1c1f"; else bg="#e9eaee"; fi
    # Row 1: "any" at 48, 96, 192. Row 2: maskable in a circle at 48, 96, 192. Row 3: favicon at 16, 32.
    magick -size 560x640 "xc:$bg" \
      "$work/any-48.png" -geometry +32+104 -composite \
      "$work/any-96.png" -geometry +112+80 -composite \
      "$work/any-192.png" -geometry +240+32 -composite \
      "$work/round-48.png" -geometry +32+328 -composite \
      "$work/round-96.png" -geometry +112+304 -composite \
      "$work/round-192.png" -geometry +240+256 -composite \
      "$work/fav-16.png" -geometry +32+520 -composite \
      "$work/fav-32.png" -geometry +64+512 -composite \
      "$preview/vela-icon-$ground.png"
  done
  # Real size, magnified 4x with no smoothing, so the pixels at 48 can be judged.
  magick "$work/any-48.png" "$work/round-48.png" "$work/fav-32.png" "$work/fav-16.png" -background "#e9eaee" -gravity center -extent 56x56 +append -filter point -resize 400% "$preview/vela-icon-small-4x.png"
  echo "previews in $preview"
fi
echo "icons written to $out"
