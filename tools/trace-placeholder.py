# placeholder.py IN OUT 1,2  -> OUT = IN with the listed pages (1-based) replaced by 1x1 white pages
import sys
from PIL import Image
src, dst, pages = sys.argv[1], sys.argv[2], {int(p) for p in sys.argv[3].split(',')}
im = Image.open(src)
frames = []
for i in range(im.n_frames):
    im.seek(i)
    frames.append(Image.new('L', (1, 1), 255) if (i + 1) in pages else im.copy())
frames[0].save(dst, save_all=True, append_images=frames[1:], dpi=(300, 300))
print(dst, [f.size for f in frames])
