"""Brand assets for Brewhouse ERP: app icons from the logo geometry, and the share and README banner.

    python3 scripts/make-brand.py [desktop_shot.png phone_shot.png]

Icons are drawn with the same geometry as assets/logo.svg. The banner (1280x640, also used as the
Open Graph image) combines the mark, the pitch and real screenshots of the app.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
A = os.path.join(ROOT, 'assets')
TOP, BOTTOM = (248, 188, 76), (220, 107, 28)


def gradient(w, h):
    """Smooth diagonal gradient: a 2x2 seed (top-left light, bottom-right dark) scaled up bilinearly."""
    mid = tuple((a + b) // 2 for a, b in zip(TOP, BOTTOM))
    seed = Image.new('RGB', (2, 2))
    seed.putdata([TOP, mid, mid, BOTTOM])
    return seed.resize((w, h), Image.BILINEAR)


def mark(size, rounded=True):
    s = 4  # draw big, then scale down for clean edges
    W = 512 * s
    im = gradient(W, W).convert('RGBA')
    if rounded:
        m = Image.new('L', (W, W), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, W - 1, W - 1], radius=114 * s, fill=255)
        im.putalpha(m)
    d = ImageDraw.Draw(im)
    k = lambda *v: [x * s for x in v]
    d.line(k(196, 368, 174, 438), fill='white', width=20 * s)
    d.line(k(316, 368, 338, 438), fill='white', width=20 * s)
    for x, y in ((174, 438), (338, 438), (196, 368), (316, 368)):
        d.ellipse(k(x - 10, y - 10, x + 10, y + 10), fill='white')
    d.rounded_rectangle(k(152, 104, 360, 340), radius=14 * s, fill='white')
    d.polygon(k(152, 326, 256, 424, 360, 326), fill='white')
    d.rectangle(k(152, 178, 360, 198), fill=(238, 143, 46))
    for x, y, r in ((226, 268, 15), (278, 304, 11), (254, 234, 8)):
        d.ellipse(k(x - r, y - r, x + r, y + r), fill=(242, 162, 58))
    return im.resize((size, size), Image.LANCZOS)


def font(size, bold=False):
    f = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)
    try:
        f.set_variation_by_name('Bold' if bold else 'Regular')
    except Exception:
        pass
    return f


def card(img, w, radius, shadow=True):
    img = img.convert('RGB')
    img = img.resize((w, int(img.height * w / img.width)), Image.LANCZOS)
    m = Image.new('L', img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=radius, fill=255)
    out = Image.new('RGBA', (img.width + 80, img.height + 80), (0, 0, 0, 0))
    if shadow:
        sh = Image.new('RGBA', out.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([40, 52, 40 + img.width, 52 + img.height], radius=radius, fill=(0, 0, 0, 70))
        out = Image.alpha_composite(out, sh.filter(ImageFilter.GaussianBlur(18)))
    piece = img.convert('RGBA')
    piece.putalpha(m)
    out.alpha_composite(piece, (40, 40))
    return out


def banner(desktop, phone, w=1280, h=640):
    im = Image.new('RGBA', (w, h), (242, 242, 247, 255))
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([w * 0.45, -h * 0.4, w * 1.3, h * 1.2], fill=TOP + (90,))
    im = Image.alpha_composite(im, glow.filter(ImageFilter.GaussianBlur(120)))
    d = ImageDraw.Draw(im)
    im.alpha_composite(mark(112), (72, 96))
    d.text((72, 238), 'Brewhouse ERP', font=font(66, True), fill=(17, 17, 20))
    y = 330
    for line in ('Free brewery software for', 'Indian microbreweries'):
        d.text((74, y), line, font=font(34), fill=(60, 60, 67))
        y += 46
    chips, x = ('Recipes', 'Tanks', 'CIP', 'Excise'), 74
    for c in chips:
        tw = d.textlength(c, font=font(22, True))
        d.rounded_rectangle([x, 450, x + tw + 32, 492], radius=21, fill=(255, 255, 255), outline=(229, 229, 234))
        d.text((x + 16, 459), c, font=font(22, True), fill=(220, 107, 28))
        x += tw + 44
    d.text((74, 530), 'ankurnapa.github.io/brewery-erp-india', font=font(22, True), fill=(60, 60, 67))
    d.text((74, 562), 'Made by Ankur Napa', font=font(22), fill=(110, 110, 118))
    if desktop and phone:
        # Screenshots stay in the right half so they never cover the text column (which ends near x=600).
        dk = card(Image.open(desktop), 560, 14)
        im.alpha_composite(dk, (w - 560 - 40 - 40, 90 - 40))
        ph = Image.open(phone).convert('RGB')
        ph = ph.crop((0, 0, ph.width, int(ph.width * 2.0)))
        pc = card(ph, 170, 24)
        im.alpha_composite(pc, (640 - 40, 250 - 40))
    return im.convert('RGB')


if __name__ == '__main__':
    os.makedirs(A, exist_ok=True)
    for size, name in ((180, 'icon-180.png'), (192, 'icon-192.png'), (512, 'icon-512.png'), (32, 'favicon-32.png')):
        mark(size, rounded=size == 32).save(os.path.join(A, name))  # iOS and Android round the full-bleed icons themselves
    desktop, phone = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else (None, None)
    b = banner(desktop, phone)
    b.save(os.path.join(A, 'header.png'), optimize=True)
    b.resize((1200, 600), Image.LANCZOS).crop((0, 0, 1200, 600)).save(os.path.join(A, 'og-image.png'), optimize=True)
    print('brand assets written to assets/')
