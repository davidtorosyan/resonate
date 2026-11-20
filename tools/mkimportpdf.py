#!/usr/bin/env python3
"""Synthetic PDFs for the PDF -> Song import tests (public-domain scores rendered with Verovio,
binarized TIFFs from scratchpad/thr): a vector title page (real text: the title comes from the
PDF's text layer) + N music pages as 300-dpi images (like a scan).
  python3 mkimportpdf.py <in.tif> <out.pdf> <title> <pages: e.g. 1,2,3> [--no-title-page]"""
import sys
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import io

src, out, title, pages = sys.argv[1:5]
title_page = '--no-title-page' not in sys.argv
im = Image.open(src)
pages = [int(p) for p in pages.split(',')]
c = None
for k, n in enumerate(pages):
    im.seek(n - 1)
    page = im.convert('1')
    w, h = page.size
    W, H = w * 72 / 300, h * 72 / 300
    if c is None:
        c = canvas.Canvas(out, pagesize=(W, H))
        if title_page:
            c.setFont('Helvetica-Bold', 36); c.drawCentredString(W / 2, H * 0.62, title)
            c.setFont('Helvetica', 14); c.drawCentredString(W / 2, H * 0.62 - 40, 'Traditional')
            c.showPage()
    buf = io.BytesIO(); page.save(buf, format='PNG'); buf.seek(0)
    c.setPageSize((W, H))
    c.drawImage(ImageReader(buf), 0, 0, W, H)
    c.showPage()
c.save()
print(out, len(pages), 'music pages', '+ title page' if title_page else '')
