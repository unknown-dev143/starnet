#!/usr/bin/env python3
"""Regenerate src-tauri/installer/header.bmp (150x57) — the NSIS inner-page header.

The Python counterpart of scripts/gen-installer-art.ps1 (which can't run here:
System.Drawing is blocked by the security guard). The ps1 remains the canonical
generator for release builds; this script exists to keep the committed artifact
honest and to prove the design is reproducible from pure Python + Pillow. Run
with the managed venv:

  C:/Users/User/.workbuddy-ai/binaries/python/envs/default/bin/python scripts/gen-header.py

Design (mirrors the ps1 — palette, seeded starfield, glow wordmark, gold rail,
every-3rd-row scanlines): SPACESTATION in bold Consolas 13 with a 6-offset
dim phosphor pass, on a near-black CRT gradient with 26 stars (seed 4242).
Only the header is generated here — the sidebar and dmg-background are
byte-stable from the prior ps1 run and are deliberately not touched."""
import os, random
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src-tauri', 'installer', 'header.bmp')

# palette — mirrors gen-installer-art.ps1 (near-black glass, phosphor green, gold)
BG0, BG1 = (2, 6, 4), (6, 22, 16)
PHOS, PHOS_DIM = (88, 255, 155), (24, 92, 56)
GOLD = (212, 175, 96)

W, H = 150, 57


def load_font(name, size):
    fonts_dir = os.path.join(os.environ.get('WINDIR') or r'C:\Windows', 'Fonts')
    for fn in (name + '.ttf', name + '.TTF', name.lower() + '.ttf'):
        p = os.path.join(fonts_dir, fn)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    # explicit fallback so a missing font on another host doesn't render as a default-glyph jitter
    return ImageFont.truetype(os.path.join(fonts_dir, 'consolab.ttf'), size) \
        if os.path.exists(os.path.join(fonts_dir, 'consolab.ttf')) \
        else ImageFont.load_default()


img = Image.new('RGB', (W, H), BG0)
d = ImageDraw.Draw(img)

# vertical CRT-glass gradient (BG0 → BG1 top-to-bottom)
for y in range(H):
    t = y / (H - 1)
    d.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(BG0, BG1)))

# seeded starfield — same seed as the ps1, so the layout matches across generators
rng = random.Random(4242)
for _ in range(26):
    x, y = rng.randrange(W), rng.randrange(H)
    v = rng.randrange(30, 110)
    img.putpixel((x, y), (v, min(255, v + 40), v))

# wordmark — bold Consolas 13, 6-offset dim phosphor glow then core
fnt = load_font('consolab', 13)
text = 'SPACESTATION'
for ox, oy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1)):
    d.text((10 + ox, 16 + oy), text, font=fnt, fill=PHOS_DIM)
d.text((10, 16), text, font=fnt, fill=PHOS)

# gold rail
d.line([(12, 42), (108, 42)], fill=GOLD, width=1)

# scanlines — every 3rd row darkened to alpha 70 (drawn LAST so it sits over everything)
overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(overlay)
for y in range(0, H, 3):
    ImageDraw.Draw(overlay).line([(0, y), (W, y)], fill=(0, 0, 0, 70), width=1)
img.paste(overlay, (0, 0), overlay)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT, 'BMP')
print(f'wrote {OUT} ({img.size[0]}x{img.size[1]})')