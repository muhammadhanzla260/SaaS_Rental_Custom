"""
Open Graph cards (1200x630) and app icons for the marketing site.
Run after adding a page:  python apps/site/scripts/og.py
Writes public/og/<slug>.png (slug = path with "/" -> "--", "home" for /) and the icons.
Events and shared pages use the lime look, car pages the violet look.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public')
FONT = next(f for f in ['C:/Windows/Fonts/seguibl.ttf', 'C:/Windows/Fonts/ariblk.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if os.path.exists(f))
FONT_UI = next(f for f in ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'] if os.path.exists(f))

PAGES = {
    '/': ('What do you rent out?', 'Rental software for event and car rental businesses', 'events'),
    '/events': ('Run your rental business without the chaos.', 'Event & equipment rental software', 'events'),
    '/events/how-it-works': ('Book it. Bill it. Deliver it.', 'How Rent Hatch runs an event rental', 'events'),
    '/events/features': ('Everything a rental business runs on.', 'Features', 'events'),
    '/events/pricing': ('Pay for the size of your business.', 'Pricing', 'events'),
    '/quiz': ('Which plan fits?', 'A 30-second quiz', 'events'),
    '/demo': ('See Rent Hatch run your Saturday.', 'Book a 20-minute demo', 'events'),
    '/cars': ('Rent out cars. Not your weekends.', 'Car & vehicle rental · early access', 'cars'),
    '/customers': ('Rental owners who got their weekends back.', 'Customers', 'events'),
    '/integrations': ('Works with the tools you already pay for.', 'Integrations', 'events'),
    '/security': ("Your customers' data, locked down.", 'Security & privacy', 'events'),
    '/about': ('Software for the people who make the party happen.', 'About', 'events'),
    '/contact': ('Talk to a human.', 'Contact', 'events'),
    '/careers': ('Small team. Real problems.', 'Careers', 'events'),
    '/blog': ('Run a better rental business.', 'The Rent Hatch blog', 'events'),
    '/blog/stop-double-booking-bounce-houses': ('How to stop double-booking your bounce houses', 'Blog', 'events'),
    '/blog/switching-from-spreadsheets': ('Switching from spreadsheets without losing a booking', 'Blog', 'events'),
    '/help': ('How can we help?', 'Help center', 'events'),
    '/changelog': ("What's new in Rent Hatch", 'Changelog', 'events'),
    '/legal/terms': ('Terms of Service', 'Legal', 'events'),
    '/legal/privacy': ('Privacy Policy', 'Legal', 'events'),
    '/legal/cookies': ('Cookie Policy', 'Legal', 'events'),
    '/legal/dpa': ('Data Processing Agreement', 'Legal', 'events'),
    '/legal/acceptable-use': ('Acceptable Use Policy', 'Legal', 'events'),
    '/404': ('This page got rented out.', 'Rent Hatch', 'events'),
}
LOOK = {
    'events': {'bg': (11, 13, 18), 'glow': (44, 79, 224), 'accent': (212, 255, 58), 'sub': (163, 171, 185)},
    'cars': {'bg': (13, 10, 24), 'glow': (109, 63, 214), 'accent': (201, 180, 255), 'sub': (185, 178, 208)},
}

def logo(size):
    """The Rent Hatch mark: volt tile, ink hatch box and lid."""
    s = size / 100
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(26 * s), fill=(212, 255, 58))
    d.rounded_rectangle([22 * s, 50 * s, 78 * s, 80 * s], radius=int(6 * s), fill=(11, 13, 18))
    lid = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(lid).rounded_rectangle([22 * s, 38 * s, 78 * s, 47 * s], radius=int(4 * s), fill=(11, 13, 18))
    lid = lid.rotate(22, center=(22 * s, 47 * s), resample=Image.BICUBIC)
    im.alpha_composite(lid)
    d.ellipse([45 * s, 59 * s, 55 * s, 69 * s], fill=(212, 255, 58))
    return im

def wrap(draw, text, font, width):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=font) <= width: cur = t
        else: lines.append(cur); cur = w
    lines.append(cur)
    return lines

def card(title, sub, look):
    L = LOOK[look]
    im = Image.new('RGBA', (1200, 630), L['bg'] + (255,))
    glow = Image.new('RGBA', (1200, 630), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(420, 0, -12):
        a = int(70 * (1 - r / 420) ** 1.6)
        gd.ellipse([1020 - r, 40 - r, 1020 + r, 40 + r], fill=L['glow'] + (a,))
    im.alpha_composite(glow)
    d = ImageDraw.Draw(im)
    im.alpha_composite(logo(64), (72, 64))
    d.text((152, 78), 'Rent Hatch', font=ImageFont.truetype(FONT, 34), fill='white')
    size = 76
    while True:
        f = ImageFont.truetype(FONT, size)
        lines = wrap(d, title, f, 1000)
        if len(lines) <= 3 or size <= 48: break
        size -= 6
    y = 520 - len(lines) * int(size * 1.08) - 40
    for i, ln in enumerate(lines):
        d.text((72, y + i * int(size * 1.08)), ln, font=f, fill=L['accent'] if i == len(lines) - 1 else 'white')
    d.text((72, 540), sub, font=ImageFont.truetype(FONT_UI, 30), fill=L['sub'])
    return im.convert('RGB')

os.makedirs(os.path.join(ROOT, 'og'), exist_ok=True)
for path, (title, sub, look) in PAGES.items():
    slug = 'home' if path == '/' else path.strip('/').replace('/', '--')
    card(title, sub, look).save(os.path.join(ROOT, 'og', slug + '.png'), optimize=True)
for name, size in [('apple-touch-icon.png', 180), ('icon-192.png', 192), ('icon-512.png', 512)]:
    logo(size).save(os.path.join(ROOT, name), optimize=True)
print(f'{len(PAGES)} cards + icons written')
