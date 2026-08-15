"""Generate the deterministic multi-resolution Component Vault Windows icon."""

from pathlib import Path

from PIL import Image, ImageDraw


CANVAS_SIZE = 1024


def create_icon() -> Image.Image:
    image = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    pixels = image.load()
    for y in range(CANVAS_SIZE):
        ratio = y / (CANVAS_SIZE - 1)
        color = (
            round(36 + 28 * ratio),
            round(29 + 18 * ratio),
            round(87 + 49 * ratio),
            255,
        )
        for x in range(CANVAS_SIZE):
            pixels[x, y] = color

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (54, 54, 970, 970),
        radius=224,
        outline=(142, 125, 255, 255),
        width=36,
    )
    draw.rounded_rectangle(
        (226, 250, 798, 798),
        radius=112,
        fill=(17, 24, 48, 255),
        outline=(191, 181, 255, 255),
        width=28,
    )
    draw.arc((322, 324, 702, 704), 36, 324, fill=(122, 222, 190, 255), width=46)
    draw.ellipse((460, 458, 564, 562), fill=(191, 181, 255, 255))
    draw.rounded_rectangle((490, 536, 534, 668), radius=22, fill=(191, 181, 255, 255))
    draw.line((184, 180, 286, 180), fill=(122, 222, 190, 255), width=26)
    draw.line((184, 180, 184, 282), fill=(122, 222, 190, 255), width=26)
    return image


def main() -> None:
    destination = Path(__file__).resolve().parents[1] / "build" / "icon.ico"
    destination.parent.mkdir(parents=True, exist_ok=True)
    create_icon().save(
        destination,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
