# contact sheet: python3 contact.py out.png cols width img...
import sys
from PIL import Image, ImageDraw
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = []
for f in sys.argv[4:]:
    im = Image.open(f).convert('RGB')
    h = int(im.height * w / im.width)
    ims.append((f.split('/')[-1], im.resize((w, h))))
rows = (len(ims) + cols - 1) // cols
hmax = max(i.height for _, i in ims)
sheet = Image.new('RGB', (cols * w, rows * (hmax + 18)), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for k, (n, im) in enumerate(ims):
    x, y = (k % cols) * w, (k // cols) * (hmax + 18)
    sheet.paste(im, (x, y + 18))
    d.text((x + 4, y + 3), n, fill=(255, 255, 255))
sheet.save(out)
