"""Generate original Stone Arena brand icons using only the Python standard library."""
from pathlib import Path
import struct
import zlib


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def pixel(x, y):
    # Pixel-art gold arena diamond, inside the maskable icon safe circle.
    base = (16, 26, 35)
    if 5 <= x < 59 and 5 <= y < 59:
        base = (26, 42, 52)
    distance = abs(x - 31.5) + abs(y - 31.5)
    if distance < 20:
        base = (164, 119, 65) if y > 31 else (232, 188, 118)
    if distance < 13:
        base = (249, 210, 148) if y < 31 else (217, 164, 93)
    return bytes(base)


root = Path(__file__).resolve().parents[1] / 'public' / 'icons'
root.mkdir(parents=True, exist_ok=True)
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
    rows = b''.join(b'\0' + b''.join(pixel(x * 64 // size, y * 64 // size) for x in range(size)) for y in range(size))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
    (root / name).write_bytes(png)
