# -*- coding: utf-8 -*-
"""Generate a minimal test PDF for canvas rendering test"""
import os

objects = []
objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>")
content = b"BT /F1 36 Tf 72 700 Td (GuaDa PDF Render Test) Tj ET\nBT /F1 18 Tf 72 660 Td (Hello from @napi-rs/canvas!) Tj ET"
objects.append(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

pdf = b"%PDF-1.4\n"
offsets = []
for i, obj in enumerate(objects, start=1):
    offsets.append(len(pdf))
    pdf += b"%d 0 obj\n" % i + obj + b"\nendobj\n"

xref_pos = len(pdf)
pdf += b"xref\n0 %d\n" % (len(objects) + 1)
pdf += b"0000000000 65535 f \n"
for off in offsets:
    pdf += b"%010d 00000 n \n" % off
pdf += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objects) + 1, xref_pos)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-render.pdf")
with open(out, "wb") as f:
    f.write(pdf)
print("Wrote", out, len(pdf), "bytes")
