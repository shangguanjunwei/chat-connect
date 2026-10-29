#!/usr/bin/env python3
"""Render the DSH Studio application icon.

Requires Pillow. Run with any Python that has it installed:

    python3 scripts/make-icon.py

Outputs build/icon.png, build/icon.icns and build/icon.ico.
"""

from __future__ import annotations

import math
import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SIZE = 1024
SS = 2  # supersampling factor for smooth curves


def rounded_mask(size: int, inset: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, size - inset, size - inset), radius=radius, fill=255
    )
    return mask


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    strip = Image.new("RGB", (1, size))
    pixels = strip.load()
    for y in range(size):
        t = y / max(1, size - 1)
        pixels[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return strip.resize((size, size), Image.BILINEAR).convert("RGBA")


def horizontal_fade(size: int, start: int, end: int, fade: int) -> Image.Image:
    """1-D alpha ramp: transparent at the tile edges, opaque in the middle."""
    row = Image.new("L", (size, 1), 0)
    pixels = row.load()
    for x in range(size):
        if x < start or x > end:
            value = 0
        elif x < start + fade:
            value = round(255 * (x - start) / fade)
        elif x > end - fade:
            value = round(255 * (end - x) / fade)
        else:
            value = 255
        pixels[x, 0] = value
    return row.resize((size, size))


def wave_mask(
    size: int,
    center_y: int,
    amplitude: int,
    period: int,
    thickness: int,
    fade: Image.Image,
) -> Image.Image:
    """Anti-aliased band following a sine wave across the tile."""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    steps = 320
    top_points: list[tuple[float, float]] = []
    bottom_points: list[tuple[float, float]] = []
    for index in range(steps + 1):
        x = size * index / steps
        y = center_y + amplitude * math.sin(x / period * math.tau)
        top_points.append((x, y - thickness / 2))
        bottom_points.append((x, y + thickness / 2))
    draw.polygon(top_points + list(reversed(bottom_points)), fill=255)
    return ImageChops.multiply(mask, fade)


def build_icon() -> Image.Image:
    s = SIZE * SS
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    inset = 34 * SS
    radius = 224 * SS
    outer_mask = rounded_mask(s, inset, radius)

    background = vertical_gradient(s, (18, 30, 74), (5, 8, 16))

    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((-320 * SS, -380 * SS, 820 * SS, 680 * SS), fill=(59, 91, 246, 165))
    glow_draw.ellipse((520 * SS, 620 * SS, 1420 * SS, 1500 * SS), fill=(34, 211, 238, 95))
    glow = glow.filter(ImageFilter.GaussianBlur(150 * SS))
    background = Image.alpha_composite(background, glow)

    # A faint edge light keeps the dark tile legible on dark desktops.
    edge = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        (inset + 2 * SS, inset + 2 * SS, s - inset - 2 * SS, s - inset - 2 * SS),
        radius=radius - 2 * SS,
        outline=(255, 255, 255, 26),
        width=2 * SS,
    )
    background = Image.alpha_composite(background, edge)

    waves = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    fade = horizontal_fade(s, inset, s - inset, 150 * SS)
    wave_specs = [
        (392, 255, (245, 249, 255)),
        (512, 185, (222, 241, 255)),
        (632, 115, (190, 228, 255)),
    ]
    for center_y, alpha, color in wave_specs:
        band = wave_mask(
            s,
            center_y * SS,
            52 * SS,
            520 * SS,
            54 * SS,
            fade,
        )
        shadow = band.filter(ImageFilter.GaussianBlur(16 * SS))
        shadow_layer = Image.new("RGBA", (s, s), (3, 8, 22, 120))
        shadow_layer.putalpha(Image.eval(shadow, lambda value: value * 0.45))
        waves = Image.alpha_composite(waves, shadow_layer)

        tint = Image.new("RGBA", (s, s), (*color, alpha))
        tint.putalpha(Image.eval(band, lambda value: round(value * alpha / 255)))
        waves = Image.alpha_composite(waves, tint)

    background = Image.alpha_composite(background, waves)

    canvas.paste(background, (0, 0), outer_mask)
    icon = canvas.crop((inset, inset, s - inset, s - inset)).resize(
        (SIZE, SIZE), Image.LANCZOS
    )
    return icon


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    icon = build_icon()
    icon.save(BUILD / "icon.png")

    iconset = BUILD / "icon.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()
    for base in (16, 32, 128, 256, 512):
        for factor, suffix in ((1, ""), (2, "@2x")):
            icon.resize((base * factor, base * factor), Image.LANCZOS).save(
                iconset / f"icon_{base}x{base}{suffix}.png"
            )
    if os.name == "posix" and shutil.which("iconutil"):
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(BUILD / "icon.icns")],
            check=True,
        )
    shutil.rmtree(iconset, ignore_errors=True)

    icon.save(
        BUILD / "icon.ico",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("icons written to", BUILD)


if __name__ == "__main__":
    main()
