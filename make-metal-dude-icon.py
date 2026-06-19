#!/usr/bin/env python3
"""Render the Metal Dude face to a multi-resolution Windows .ico (no SVG renderer needed).

Draws the same character as the in-app avatar (long dark hair curtains, pale face,
full beard, heavy brow, red-glint eyes) with Pillow primitives, supersampled for
clean edges, then saves metal-dude.ico with the standard icon sizes.
"""
from PIL import Image, ImageDraw

# Supersample at 1024 then downscale for crisp anti-aliasing.
S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

def sc(x):  # scale 0..80 svg space -> 0..1024
    return x * (S / 80.0)

DARK_BG   = (12, 12, 17, 255)
RED       = (225, 6, 0, 255)
HAIR      = (10, 10, 13, 255)
HAIR_FR   = (18, 18, 22, 255)
FACE      = (216, 180, 140, 255)
BEARD     = (13, 10, 8, 255)
BROW      = (13, 10, 8, 255)
EYE       = (22, 19, 24, 255)

# --- dark round background + crimson ring (matches the avatar button) ---
d.ellipse([sc(2), sc(2), sc(78), sc(78)], fill=DARK_BG)
ring = max(6, int(sc(2)))
d.ellipse([sc(2), sc(2), sc(78), sc(78)], outline=RED, width=ring)

# --- hair behind (long straight curtains) ---
d.polygon([(sc(40), sc(6)), (sc(16), sc(10)), (sc(12), sc(34)), (sc(15), sc(60)),
           (sc(20), sc(74)), (sc(27), sc(74)), (sc(24), sc(50)), (sc(25), sc(30)),
           (sc(31), sc(16)), (sc(40), sc(13)), (sc(49), sc(16)), (sc(55), sc(30)),
           (sc(56), sc(50)), (sc(53), sc(74)), (sc(60), sc(74)), (sc(65), sc(60)),
           (sc(68), sc(34)), (sc(64), sc(10))], fill=HAIR)

# --- pale face ---
d.ellipse([sc(28), sc(19), sc(52), sc(57)], fill=FACE)

# --- full beard over the jaw ---
d.polygon([(sc(29), sc(43)), (sc(33), sc(58)), (sc(40), sc(62)), (sc(47), sc(58)),
           (sc(51), sc(43)), (sc(48), sc(54)), (sc(40), sc(58)), (sc(32), sc(54))],
          fill=BEARD)
d.ellipse([sc(32), sc(48), sc(48), sc(63)], fill=BEARD)

# --- heavy angry brows ---
d.polygon([(sc(30), sc(33)), (sc(39), sc(37)), (sc(39), sc(39)), (sc(30), sc(35))], fill=BROW)
d.polygon([(sc(50), sc(33)), (sc(41), sc(37)), (sc(41), sc(39)), (sc(50), sc(35))], fill=BROW)

# --- narrowed eyes + red glint ---
d.ellipse([sc(32), sc(38), sc(38), sc(41)], fill=EYE)
d.ellipse([sc(42), sc(38), sc(48), sc(41)], fill=EYE)
r = sc(1.3)
d.ellipse([sc(35) - r, sc(39) - r, sc(35) + r, sc(39) + r], fill=RED)
d.ellipse([sc(45) - r, sc(39) - r, sc(45) + r, sc(39) + r], fill=RED)

# --- horseshoe mustache ---
d.polygon([(sc(33.5), sc(46)), (sc(40), sc(49)), (sc(46.5), sc(46)),
           (sc(45.5), sc(50)), (sc(40), sc(50.5)), (sc(34.5), sc(50))], fill=BEARD)

# --- front side curtains over the face edges ---
d.polygon([(sc(26), sc(27)), (sc(24), sc(40)), (sc(25), sc(55)), (sc(28), sc(61)),
           (sc(22), sc(58)), (sc(20), sc(40)), (sc(24), sc(27))], fill=HAIR_FR)
d.polygon([(sc(54), sc(27)), (sc(56), sc(40)), (sc(55), sc(55)), (sc(52), sc(61)),
           (sc(58), sc(58)), (sc(60), sc(40)), (sc(56), sc(27))], fill=HAIR_FR)
# center-parted fringe
d.polygon([(sc(40), sc(12)), (sc(27), sc(17)), (sc(26), sc(28)), (sc(31), sc(24)),
           (sc(40), sc(18)), (sc(49), sc(24)), (sc(54), sc(28)), (sc(53), sc(17))], fill=HAIR_FR)

sizes = [256, 128, 64, 48, 32, 16]
img.resize((256, 256), Image.LANCZOS).save(
    "metal-dude.ico", format="ICO", sizes=[(s, s) for s in sizes])
img.resize((256, 256), Image.LANCZOS).save("metal-dude.png")
print("Wrote metal-dude.ico + metal-dude.png")
