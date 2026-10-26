"""Render Photo Helper results (marks with normalized coords) onto the photo, like the app does."""
import json, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

F = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def render(photo, res, out):
    im = Image.open(photo).convert("RGB")
    im.thumbnail((1080, 1080))
    W, H = im.size
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(F, max(18, W // 38))
    for m in res.get("marks", []):
        x, y, r = m["x"] * W, m["y"] * H, max(16, m["radius"] * W)
        d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 214, 10), width=6)
        bx, by = min(max(24, x - r * 0.72), W - 24), min(max(24, y - r * 0.72), H - 24)
        d.ellipse([bx - 22, by - 22, bx + 22, by + 22], fill=(255, 214, 10), outline=(0, 0, 0), width=3)
        d.text((bx, by), str(m["n"]), font=f, fill=(0, 0, 0), anchor="mm")
    # panel below
    lines = []
    fb, fr = ImageFont.truetype(F, 30), ImageFont.truetype(FR, 24)
    title = res.get("title", "")
    lines.append((fb, f"Photo Helper: {title}"))
    for m in res.get("marks", []):
        lines.append((fb, m["text"]))
    if res.get("message"):
        lines.append((fb, res["message"]))
    for w in res.get("warnings", []):
        lines += [(fr, t) for t in textwrap.wrap("⚠ " + w, 70)]
    for i, s in enumerate(res.get("steps", []), 1):
        lines += [(fr, t) for t in textwrap.wrap(f"{i}. {s}", 70)]
    lines.append((fr, ""))
    lines += [(fr, t) for t in textwrap.wrap(res.get("disclaimer", ""), 70)]
    lines.append((ImageFont.truetype(FR, 18), "MOCKUP · synthetic AI-generated photo, not a real car · Powered by Meta AI"))
    ph = 30 + sum(36 for _ in lines)
    canvas = Image.new("RGB", (W, H + ph), (11, 15, 20))
    canvas.paste(im, (0, 0))
    cd = ImageDraw.Draw(canvas)
    y = H + 16
    for fo, t in lines:
        cd.text((20, y), t, font=fo, fill=(242, 245, 248))
        y += 36
    canvas.save(out)


if __name__ == "__main__":
    render(sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3])
