# Design system

The visual language follows the Sofia Urban Mobility Center (sofiatraffic.bg) and the Sofia Municipality (sofia.bg).
It is meant to feel civic, calm and trustworthy. All tokens live at the top of `wwwroot/css/app.css`.

## Colour

| Token | Value | Use |
| --- | --- | --- |
| `--navy` | `#2B3C8F` | Brand, primary actions, metro |
| `--navy-deep` | `#1F2C6E` | Top bar, pressed states |
| `--bus` | `#BE1E2D` | Bus lines |
| `--tram` | `#F7941D` | Tram lines |
| `--trolley` | `#27AAE1` | Trolleybus lines |
| `--ok` / `--warn` / `--bad` | `#15803D` / `#B45309` / `#B91C1C` | On time / delayed (≥ 3 min) / severely delayed (≥ 10 min) |

Neutrals are tinted towards the navy hue. Mode colours are the only saturated accents. Delay status is always
shown with text as well as colour.

## Type

- **Sofia Sans** for body and UI text, and **Sofia Sans Condensed** for headings, line numbers and numeric KPIs.
  Sofia Sans is the typeface commissioned for the city of Sofia, and it includes full Cyrillic.
- Body text is 15 px with a line height of 1.5. Use tabular numerals for times and delays.

## Shape and layout

- Corner radius is 4 px for controls and 8 px for cards and sheets. Borders are hairline, with shadows only on floating map UI.
- Desktop layout: a 60 px top bar, a 420 px side panel and a full-bleed map.
- Mobile layout (≤ 860 px): the panel becomes a bottom sheet at 46 % of the viewport height and the map zoom control is hidden.

## Components

- Line badges are condensed numerals on the mode colour.
- Vehicle markers are mode-coloured with a bearing notch.
- Departure rows show a live indicator.
- The journey timeline uses walking legs (dashed) and transit legs (mode colour).
- Stats show KPI strips and Chart.js charts using the same tokens.

## Motion

The only authored motion is the vehicles gliding between realtime updates. Everything else changes state instantly
or with short fades. `prefers-reduced-motion` disables the glide.

## Accessibility

- Visible focus rings on all controls.
- Comboboxes follow the ARIA pattern.
- Decorative map labels are hidden from assistive technology.
- Colour contrast is AA or better.
