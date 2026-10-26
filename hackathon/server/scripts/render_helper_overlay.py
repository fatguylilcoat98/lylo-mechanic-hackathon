"""Render Photo Helper results (marks with normalized coords) onto the photo, like the app does."""
import json, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

F = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


MAX_R, ANGLES = 0.15, [225, 315, 135, 45, 270, 90, 180, 0]


def layout(marks, W, H, br):
    """Same algorithm as mobile-bridge layoutMarks: shrink overlapping circles, place badges clear."""
    import math
    minr = max(10, W * 0.02)
    out = [dict(m, cx=m["x"] * W, cy=m["y"] * H, r=max(minr, min(MAX_R, max(0.02, m["radius"])) * W)) for m in marks[:6]]
    for i in range(len(out)):
        for j in range(i + 1, len(out)):
            a, b = out[i], out[j]
            d = math.hypot(a["cx"] - b["cx"], a["cy"] - b["cy"])
            if d < a["r"] + b["r"] + 4:
                k = max(0, d - 4) / (a["r"] + b["r"])
                a["r"], b["r"] = max(minr, a["r"] * k), max(minr, b["r"] * k)
    placed = []
    for m in out:
        best = None
        for deg in ANGLES:
            t = math.radians(deg); dist = m["r"] + br + 2
            bx = min(max(br, m["cx"] + math.cos(t) * dist), W - br)
            by = min(max(br, m["cy"] - math.sin(t) * dist), H - br)
            clash = any(math.hypot(px - bx, py - by) < 2 * br + 2 for px, py in placed) or \
                any(o is not m and math.hypot(o["cx"] - bx, o["cy"] - by) < o["r"] + br * 0.5 for o in out)
            best = best or (bx, by)
            if not clash:
                best = (bx, by)
                break
        m["bx"], m["by"] = best
        placed.append(best)
    return out


def render(photo, res, out):
    im = Image.open(photo).convert("RGB")
    im.thumbnail((1080, 1080))
    W, H = im.size
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(F, max(18, W // 38))
    for m in layout(res.get("marks", []), W, H, 22):
        x, y, r, bx, by = m["cx"], m["cy"], m["r"], m["bx"], m["by"]
        d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 214, 10), width=5)
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
