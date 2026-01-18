#!/usr/bin/env python3
"""
Simple PNG icon generator without external dependencies.
Creates gradient-colored square icons for Chrome extension.
"""

import zlib
import struct
import os

def create_png(width, height, pixels):
    """Create a PNG file from pixel data."""

    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        crc = zlib.crc32(chunk) & 0xffffffff
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', crc)

    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = make_chunk(b'IHDR', ihdr_data)

    # IDAT chunk (image data)
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # Filter type: None
        for x in range(width):
            idx = (y * width + x) * 4
            raw_data += bytes(pixels[idx:idx+4])

    compressed = zlib.compress(raw_data, 9)
    idat = make_chunk(b'IDAT', compressed)

    # IEND chunk
    iend = make_chunk(b'IEND', b'')

    return signature + ihdr + idat + iend


def create_gradient_icon(size):
    """Create a circular gradient icon."""
    pixels = []
    center = size / 2
    radius = size / 2 - 1

    for y in range(size):
        for x in range(size):
            # Distance from center
            dx = x - center
            dy = y - center
            dist = (dx * dx + dy * dy) ** 0.5

            if dist <= radius:
                # Inside circle - gradient from purple to blue
                t = (x + y) / (size * 2)  # Gradient factor

                # Color interpolation: #667eea to #764ba2
                r1, g1, b1 = 0x66, 0x7e, 0xea
                r2, g2, b2 = 0x76, 0x4b, 0xa2

                r = int(r1 + (r2 - r1) * t)
                g = int(g1 + (g2 - g1) * t)
                b = int(b1 + (b2 - b1) * t)

                # Anti-aliasing at edge
                if dist > radius - 1:
                    alpha = int(255 * (radius - dist + 1))
                else:
                    alpha = 255

                pixels.extend([r, g, b, alpha])
            else:
                # Outside circle - transparent
                pixels.extend([0, 0, 0, 0])

    return pixels


def create_broom_icon(size):
    """Create a broom icon with gradient background."""
    pixels = []
    center = size / 2
    radius = size / 2 - 1

    for y in range(size):
        for x in range(size):
            dx = x - center
            dy = y - center
            dist = (dx * dx + dy * dy) ** 0.5

            if dist <= radius:
                # Gradient background
                t = (x + y) / (size * 2)
                r1, g1, b1 = 0x66, 0x7e, 0xea
                r2, g2, b2 = 0x76, 0x4b, 0xa2

                r = int(r1 + (r2 - r1) * t)
                g = int(g1 + (g2 - g1) * t)
                b = int(b1 + (b2 - b1) * t)

                # Add broom design for larger icons
                if size >= 48:
                    # Broom handle (diagonal line)
                    handle_dist = abs((x - y) - (size * 0.1))
                    if handle_dist < size * 0.05 and x > size * 0.3 and y < size * 0.7:
                        r, g, b = 0xff, 0xd7, 0x00  # Gold color

                    # Broom head (bottom left)
                    if x < size * 0.4 and y > size * 0.65:
                        brush_x = x - size * 0.25
                        brush_y = y - size * 0.75
                        if abs(brush_x) < size * 0.15:
                            r, g, b = 0x8b, 0x45, 0x13  # Brown

                # Sparkle in top right for larger icons
                if size >= 48:
                    sparkle_dist = ((x - size * 0.75) ** 2 + (y - size * 0.25) ** 2) ** 0.5
                    if sparkle_dist < size * 0.06:
                        r, g, b = 255, 255, 255

                # Anti-aliasing
                if dist > radius - 1:
                    alpha = int(255 * max(0, min(1, radius - dist + 1)))
                else:
                    alpha = 255

                # Clamp values to 0-255
                r = max(0, min(255, r))
                g = max(0, min(255, g))
                b = max(0, min(255, b))
                alpha = max(0, min(255, alpha))

                pixels.extend([r, g, b, alpha])
            else:
                pixels.extend([0, 0, 0, 0])

    return pixels


def main():
    sizes = [16, 48, 128]
    icons_dir = os.path.join(os.path.dirname(__file__), '..', 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    for size in sizes:
        pixels = create_broom_icon(size)
        png_data = create_png(size, size, pixels)

        output_path = os.path.join(icons_dir, f'icon{size}.png')
        with open(output_path, 'wb') as f:
            f.write(png_data)

        print(f'Created: {output_path}')

    print('\nAll icons generated successfully!')


if __name__ == '__main__':
    main()
