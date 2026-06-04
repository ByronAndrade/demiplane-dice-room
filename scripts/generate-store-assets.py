from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math


ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ASSETS = ROOT / "extension" / "public" / "assets"
STORE_ASSETS = ROOT / "store-assets"
SCREENSHOT_DIR = STORE_ASSETS / "screenshots" / "chrome-edge-firefox"
OPERA_SCREENSHOT_DIR = STORE_ASSETS / "screenshots" / "opera"

FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_MONO if mono else FONT_BOLD if bold else FONT_REG
    return ImageFont.truetype(path, size)


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int, fill, outline=None, width: int = 1) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def label(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    value: str,
    size: int = 24,
    fill=(238, 242, 250, 255),
    bold: bool = False,
    mono: bool = False,
    anchor: str | None = None
) -> None:
    draw.text(xy, value, font=font(size, bold, mono), fill=fill, anchor=anchor)


def draw_diamond(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    size: float,
    fill,
    outline=(238, 242, 250, 255),
    width: int = 3,
    angle: float = 0
) -> None:
    points = [(0, -size), (size, 0), (0, size), (-size, 0)]
    cos_a = math.cos(math.radians(angle))
    sin_a = math.sin(math.radians(angle))
    polygon = [(cx + x * cos_a - y * sin_a, cy + x * sin_a + y * cos_a) for x, y in points]
    draw.polygon(polygon, fill=fill, outline=outline)
    for inset in range(1, width):
        next_size = max(1, size - inset)
        next_points = [(0, -next_size), (next_size, 0), (0, next_size), (-next_size, 0)]
        next_polygon = [(cx + x * cos_a - y * sin_a, cy + x * sin_a + y * cos_a) for x, y in next_points]
        draw.line(next_polygon + [next_polygon[0]], fill=outline, width=1)


def draw_icon(size: int, output_path: Path) -> None:
    scale = size / 128
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    pad = int(8 * scale)
    draw.ellipse(
        (pad, pad, size - pad, size - pad),
        fill=(17, 22, 31, 255),
        outline=(226, 43, 64, 255),
        width=max(2, int(5 * scale))
    )
    draw.ellipse(
        (pad + int(7 * scale), pad + int(7 * scale), size - pad - int(7 * scale), size - pad - int(7 * scale)),
        outline=(255, 94, 111, 150),
        width=max(1, int(2 * scale))
    )
    draw_diamond(draw, size * 0.50, size * 0.36, size * 0.19, (216, 28, 54, 255), width=max(1, int(3 * scale)), angle=2)
    draw_diamond(draw, size * 0.35, size * 0.58, size * 0.18, (8, 12, 18, 255), width=max(1, int(3 * scale)), angle=15)
    draw_diamond(draw, size * 0.66, size * 0.60, size * 0.18, (8, 12, 18, 255), width=max(1, int(3 * scale)), angle=-10)
    image.save(output_path)


def create_background() -> Image.Image:
    width, height = 1280, 800
    image = Image.new("RGBA", (width, height), (6, 7, 9, 255))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        red = int(6 + 28 * y / height)
        green = 9 + int(8 * y / height)
        blue = 12 + int(12 * y / height)
        draw.line((0, y, width, y), fill=(red, green, blue, 255))

    draw.rectangle((0, 0, width, 74), fill=(8, 10, 14, 255))
    label(draw, (88, 26), "CHARACTER SHEET", 26, (245, 245, 245, 255), True)
    for x, text in [(390, "LIBRARY"), (515, "GAME RULES"), (675, "GROUPS"), (815, "CHRONICLES"), (995, "CHARACTERS")]:
        label(draw, (x, 34), text, 16, (230, 234, 242, 255), True)

    draw.line((0, 82, width, 82), fill=(134, 23, 36, 255), width=2)
    label(draw, (80, 112), "HELENA", 40, (245, 246, 250, 255), True)
    for column, x in [("PHYSICAL", 45), ("SOCIAL", 455), ("MENTAL", 865)]:
        label(draw, (x, 170), column, 18, (187, 190, 198, 255), True)
        for index, trait in enumerate(["STRENGTH", "DEXTERITY", "STAMINA"]):
            y = 200 + index * 50
            draw.rectangle((x, y, x + 330, y + 38), fill=(16, 18, 22, 220))
            label(draw, (x + 18, y + 10), trait, 15, (238, 242, 250, 255))
            draw.ellipse((x + 260, y + 11, x + 273, y + 24), fill=(229, 43, 64, 255))
            draw.ellipse((x + 280, y + 11, x + 293, y + 24), fill=(229, 43, 64, 255))

    label(draw, (45, 365), "SKILLS", 34, (245, 190, 65, 255), True)
    draw.line((0, 385, width, 385), fill=(151, 32, 48, 255), width=3)
    return image


def draw_panel_header(image: Image.Image, expanded: bool) -> tuple[int, int, int, int]:
    draw = ImageDraw.Draw(image)
    x, y, width = 76, 112, 850
    header_height = 118
    rounded(draw, (x, y, x + width, y + header_height), 24, (15, 19, 26, 248), (65, 75, 90, 255), 3)
    rounded(draw, (x + 34, y + 30, x + 190, y + 88), 30, (18, 24, 33, 255), (62, 72, 88, 255), 3)
    draw_diamond(draw, x + 98, y + 48, 18, (216, 28, 54, 255), angle=2)
    draw_diamond(draw, x + 75, y + 68, 16, (8, 12, 18, 255), angle=15)
    draw_diamond(draw, x + 125, y + 70, 16, (8, 12, 18, 255), angle=-10)
    rounded(draw, (x + 420, y + 36, x + 550, y + 82), 23, (23, 34, 48, 255), (92, 112, 139, 255), 3)
    label(draw, (x + 485, y + 59), "Local", 28, (236, 242, 250, 255), True, anchor="mm")
    label(draw, (x + 575, y + 58), "v0.1.113", 22, (176, 186, 202, 255), True, anchor="lm")
    rounded(draw, (x + 710, y + 30, x + 774, y + 92), 14, (28, 37, 50, 255), (60, 74, 92, 255), 3)
    label(draw, (x + 742, y + 61), "gear", 13, (220, 228, 238, 255), anchor="mm")
    rounded(draw, (x + 786, y + 30, x + 850, y + 92), 14, (28, 37, 50, 255), (60, 74, 92, 255), 3)
    label(draw, (x + 818, y + 61), "^", 34, (232, 238, 248, 255), True, anchor="mm")
    if expanded:
        rounded(draw, (x, y + header_height, x + width, y + 670), 0, (15, 19, 24, 238), (56, 65, 78, 255), 2)
    return x, y, width, header_height


def screenshot_room() -> Image.Image:
    image = create_background()
    draw = ImageDraw.Draw(image)
    x, y, _, _ = draw_panel_header(image, True)
    label(draw, (x + 36, y + 160), "TABLE ROOM", 22, (244, 247, 252, 255), True)
    for offset, left, right in [
        (216, "Room", "rio_by_night"),
        (254, "Storyteller", "Byron"),
        (292, "Players", "3 connected"),
    ]:
        label(draw, (x + 36, y + offset), left, 18, (172, 182, 198, 255), True)
        label(draw, (x + 510, y + offset), right, 20, (245, 248, 252, 255), True)

    for index, (name, color) in enumerate([("Pablo", (40, 48, 61)), ("Byron Storyteller", (22, 78, 49)), ("Helena", (40, 48, 61))]):
        tx = x + 36 + index * 180
        rounded(draw, (tx, y + 330, tx + 150, y + 360), 15, color, (80, 96, 116, 255), 2)
        label(draw, (tx + 75, y + 346), name, 13, (235, 240, 250, 255), True, anchor="mm")

    rounded(draw, (x + 36, y + 395, x + 724, y + 488), 8, (34, 43, 55, 255), (69, 82, 101, 255), 2)
    label(draw, (x + 64, y + 420), "Recent roll", 18, (184, 193, 207, 255), True)
    label(draw, (x + 64, y + 452), "DEXTERITY + STEALTH", 26, (238, 43, 64, 255), True)
    label(draw, (x + 470, y + 452), "SUCCESS: 4", 24, (244, 248, 252, 255), True)
    return image


def screenshot_shared_dice() -> Image.Image:
    image = create_background()
    draw = ImageDraw.Draw(image)
    draw_panel_header(image, False)
    for cx, cy, value, color in [
        (530, 450, "7", (18, 24, 33)),
        (620, 500, "10", (130, 20, 36)),
        (715, 438, "3", (18, 24, 33)),
        (790, 530, "9", (18, 24, 33)),
        (900, 468, "1", (130, 20, 36)),
    ]:
        draw.ellipse((cx - 48, cy - 48, cx + 48, cy + 48), fill=(*color, 240), outline=(230, 238, 248, 255), width=4)
        die_fill = (216, 28, 54, 255) if color[0] > 50 else (8, 12, 18, 255)
        draw_diamond(draw, cx, cy, 30, die_fill, angle=(cx + cy) % 37)
        label(draw, (cx, cy + 2), value, 18, (245, 248, 252, 255), True, anchor="mm")

    rounded(draw, (60, 588, 360, 748), 4, (21, 22, 27, 250), (180, 24, 42, 255), 2)
    label(draw, (84, 616), "INTELLIGENCE + OCCULT", 18, (232, 43, 64, 255), True)
    label(draw, (84, 654), "SUCCESS: 4", 22, (248, 250, 253, 255), True)
    label(draw, (84, 694), "Details", 14, (173, 183, 197, 255))
    label(draw, (84, 724), "Regular 3  Hunger 1", 16, (230, 236, 246, 255), True)
    return image


def screenshot_settings() -> Image.Image:
    image = create_background()
    draw = ImageDraw.Draw(image)
    x, y, _, _ = draw_panel_header(image, True)
    label(draw, (x + 36, y + 160), "TABLE ROOM", 22, (244, 247, 252, 255), True)
    label(draw, (x + 36, y + 210), "Mode", 22, (210, 218, 232, 255), True)
    rounded(draw, (x + 36, y + 244, x + 350, y + 300), 8, (18, 67, 42, 255), (54, 151, 91, 255), 3)
    label(draw, (x + 193, y + 272), "Create", 24, (236, 242, 250, 255), True, anchor="mm")
    rounded(draw, (x + 376, y + 244, x + 690, y + 300), 8, (30, 39, 52, 255), (63, 77, 98, 255), 3)
    label(draw, (x + 533, y + 272), "Join", 24, (210, 218, 232, 255), True, anchor="mm")
    for index, name in enumerate(["Player name", "Room", "Password", "Confirm password"]):
        yy = y + 320 + index * 72
        label(draw, (x + 36, yy), name, 18, (215, 223, 236, 255), True)
        rounded(draw, (x + 36, yy + 26, x + 760, yy + 64), 8, (30, 39, 52, 255), (63, 77, 98, 255), 2)
    rounded(draw, (x + 36, y + 622, x + 760, y + 684), 10, (15, 20, 26, 250), (49, 59, 72, 255), 2)
    label(draw, (x + 64, y + 653), "ADVANCED SETTINGS", 22, (236, 242, 250, 255), True, anchor="lm")
    label(draw, (x + 725, y + 653), "+", 34, (210, 218, 232, 255), True, anchor="mm")
    return image


def generate() -> None:
    for directory in [EXTENSION_ASSETS, STORE_ASSETS, SCREENSHOT_DIR, OPERA_SCREENSHOT_DIR]:
        directory.mkdir(parents=True, exist_ok=True)

    for size in [16, 32, 48, 128]:
        draw_icon(size, EXTENSION_ASSETS / f"icon-{size}.png")
    draw_icon(300, STORE_ASSETS / "icon-300.png")

    promo = Image.new("RGBA", (440, 280), (9, 12, 17, 255))
    draw = ImageDraw.Draw(promo)
    for index in range(10):
        x = -120 + index * 62
        draw.line((x, 280, x + 190, 0), fill=(54, 10, 20, 58), width=20)
    rounded(draw, (28, 38, 412, 242), 22, (18, 24, 33, 248), (67, 79, 96, 255), 2)
    icon = Image.open(STORE_ASSETS / "icon-300.png").resize((86, 86), Image.Resampling.LANCZOS)
    promo.alpha_composite(icon, (48, 96))
    label(draw, (158, 82), "Demiplane", 21, (177, 187, 202, 255), True)
    label(draw, (158, 114), "Dice Room", 35, (246, 248, 252, 255), True)
    label(draw, (160, 168), "Shared rolls for online tables", 16, (210, 220, 232, 255))
    rounded(draw, (160, 202, 286, 230), 14, (22, 76, 49, 255), (57, 169, 103, 255), 2)
    label(draw, (223, 216), "Connected", 15, (223, 255, 235, 255), True, anchor="mm")
    promo.convert("RGB").save(STORE_ASSETS / "promo-small-440x280.png", quality=95)

    large = Image.new("RGBA", (1400, 560), (9, 12, 17, 255))
    draw = ImageDraw.Draw(large)
    for index in range(18):
        x = -160 + index * 92
        draw.line((x, 560, x + 360, 0), fill=(54, 10, 20, 54), width=34)
    rounded(draw, (90, 78, 1310, 482), 42, (18, 24, 33, 248), (67, 79, 96, 255), 4)
    icon = Image.open(STORE_ASSETS / "icon-300.png").resize((190, 190), Image.Resampling.LANCZOS)
    large.alpha_composite(icon, (160, 185))
    label(draw, (420, 158), "Demiplane", 48, (177, 187, 202, 255), True)
    label(draw, (420, 228), "Dice Room", 88, (246, 248, 252, 255), True)
    label(draw, (424, 346), "Shared rolls for online tabletop groups", 36, (210, 220, 232, 255))
    rounded(draw, (424, 410, 690, 468), 28, (22, 76, 49, 255), (57, 169, 103, 255), 4)
    label(draw, (557, 439), "Connected", 31, (223, 255, 235, 255), True, anchor="mm")
    large.convert("RGB").save(STORE_ASSETS / "promo-large-1400x560.png", quality=95)

    screenshots = [
        ("01-room-panel-1280x800.png", screenshot_room()),
        ("02-shared-dice-1280x800.png", screenshot_shared_dice()),
        ("03-advanced-settings-1280x800.png", screenshot_settings()),
    ]
    for name, image in screenshots:
        image.convert("RGB").save(SCREENSHOT_DIR / name, quality=95)
        small_name = name.replace("1280x800", "612x408")
        image.convert("RGB").resize((612, 408), Image.Resampling.LANCZOS).save(OPERA_SCREENSHOT_DIR / small_name, quality=95)


if __name__ == "__main__":
    generate()
    print("Generated store assets.")
