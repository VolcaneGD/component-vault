# Component Vault archive icon design

## Goal

Replace the stretched home-card placeholder with a polished square application icon that communicates reusable HTML components being registered and saved.

## Visual direction

- Use a dark navy rounded-square canvas, matching the restrained, object-led visual weight of Quota Glance.
- Place a small component card bearing the literal `</>` mark above a shallow archive tray.
- Add one compact checkmark badge to communicate that the component has been registered or saved.
- Use cyan as the primary highlight, with one restrained mint or warm accent; avoid text beyond `</>`, gradients, glow, photorealism, and visual clutter.
- Keep the card, tray, and checkmark legible when the icon is shown in the site's 16:9 card-image frame.

## Integration

- Generate a square PNG web asset and reference it with an `img` element in the home **Card Grid** and Component Vault product page.
- Let the existing `.card-image img` `object-fit: cover` rule fill the card frame, replacing the incorrect full-height placeholder div.
- Reuse the same PNG on the product page so the public identity stays consistent.

## Verification

- Add a focused regression check that the home card uses an image asset rather than the placeholder mark.
- Build the portfolio and inspect the rendered home card and product page at desktop and narrow widths.
- Confirm the image remains square, centered, readable, and does not overflow or stretch.
