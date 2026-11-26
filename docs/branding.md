# Brand your roadmap

Create `brand.yaml` next to `roadmap.yaml` to style every page in your workspace. Use `schema_version: 1` and add the settings you want to customize. Missing settings use the built-in design.

```yaml
schema_version: 1
colors:
  background: '#eef3f8'
  surface: '#fbfdff'
  text: '#10243b'
  accent: '#07548c'
typography:
  body:
    font:
      family: Inter Tight
      file: brand/inter-tight.woff2
      weight: [100, 900]
      license: brand/inter-tight-ofl.txt
    tracking: 0.012
    line_height: 1.55
  display:
    font:
      family: Bricolage Grotesque
      file: brand/bricolage-grotesque.woff2
      weight: [200, 800]
      license: brand/bricolage-grotesque-ofl.txt
    tracking: -0.035
  header:
    font:
      family: Bricolage Grotesque
header:
  background: '#102b48'
  text: '#edf6ff'
  muted: '#c3daee'
  accent: '#a6dcfc'
  logo:
    file: brand/compass.png
    height: 34
    aspect: 1
background:
  image: brand/contours.png
  fit: contain
  position: top right
```

Save images and fonts inside the workspace. Use paths relative to `brand.yaml` with lowercase file extensions and `/` separators. `roadmark lint` reports invalid settings and assets with their location in the file. `roadmark dev` reloads when you change the settings or replace an asset. Builds publish local copies under fingerprinted URLs that work with `--base`.

## Colors

Use quoted `#rgb` or `#rrggbb` values for all colors. Set related foreground and background colors together so labels and controls remain readable.

When you set `background` or `surface`, the site derives the sunken surfaces (timeline lane headers, table headers, inline code), dividers and control outlines from your palette. Leave `accent_wash` out to derive the tint used for highlighted rows, active filter chips and the selected timeline bar.

The accent marks where the reader is and what they can act on: links, the current page in the header, and keyboard focus. Status colours stay fixed so they keep their meaning in every brand: green for done and shipped, teal for in progress, amber for work that needs attention and red for conflicts. A `surface` darker than mid-grey switches the site to a dark colour scheme, which also retunes those status colours for contrast.

| Key under `colors`                                     | Applies to                                           |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `background`, `surface`                                | Page backdrop and surfaces such as cards and dialogs |
| `text`, `heading`, `muted`                             | Main copy, headings and secondary labels             |
| `border`, `strong_border`                              | Dividers, outlines and form borders                  |
| `accent`, `accent_hover`, `accent_wash`                | Links and actions, hover states and accent tints     |
| `inverse_background`, `inverse_text`, `inverse_accent` | Dark surfaces such as code samples                   |

## Typography

Set `body`, `display`, or `header` under `typography`. The built-in design uses the system UI font for body text and Geist for page titles and the workspace name. Display styles apply to page and section titles. Header styles apply to the primary navigation and search button, and to the workspace name when they set a font or tracking.

- `font.family` names a typeface. With `font.file`, the browser loads the local WOFF2 file. A family without a file uses an available font by that name, then falls back to the built-in stack. You can reference the same family from two roles and declare the file once.
- `font.weight` defaults to `400`. Give one integer weight for a static font or an ascending range such as `[200, 800]` for a variable font. Values run from `100` through `900`.
- Set `font.license` alongside `font.file` to publish its redistribution terms. Use a local UTF-8 `.txt` file. The generated brand stylesheet lists the published license path next to the font.
- `tracking` is letter spacing in `em`, from `-0.12` to `0.3`.
- `line_height` is a unitless multiplier from `0.8` to `2.5`.

## Header and background

Set `header.background`, `header.text`, `header.muted`, `header.accent`, and `header.border` to style the workspace navigation. The active navigation link uses the header accent. `header.logo.file` accepts a still PNG or WebP. `height` is the displayed height in pixels from `16` to `64`, with a default of `30`; the header keeps that height and the logo's aspect ratio, and narrows only a very wide logo on small screens. The aspect ratio comes from the image unless `aspect` specifies a width-to-height ratio. Use `show_title: false` for a logo that already includes the workspace name. The home link retains the workspace name for assistive technology.

`background.image` accepts a still PNG, JPEG, or WebP. It sits over the page background color. Use `fit: cover` (the default), `contain`, or `tile`, and position it at `center` (the default), `top left`, or `top right`.

The ai-sandbox template provides an example configuration and local logo. [ai-sandbox brand file](../apps/cli/templates/ai-sandbox/brand.yaml) · [Editor schema](schemas/brand.json)
