# Astralium Digitale Store — Brand Guide

The identity kit for Astralium. Everything here is generated from two
sources of truth in code — artwork: `src/lib/brand.ts`, colours:
`src/lib/themes.ts` — by `node scripts/generate-brand.mjs`. Edit the
code, re-run the script, and the kit (including `COLORS.md`) updates.

> ## ⚠ Trademark warning — read before adopting the logo
> This logo and name are an **original design** created for this
> store; no other brand's registered marks were copied or referenced.
> That is **not** a clearance. Before using the mark in trade, run a
> **trademark clearance search** for “Astralium” (and similar names)
> in every market and Nice class you will sell in (notably classes 9,
> 35 and 41), and register the mark once cleared. Budget for a local
> IP attorney — a search is cheap insurance against a forced rebrand.

## The mark

A four-point **astral star** (an astroid sparkle, drawn from a
parametric curve) inside a fine double **ring**, crossed by a tilted
**orbit** carrying one small **planet**, with an ivory jewel at the
star's heart. It reads as: digital products, delivered among the
stars — precious, precise, a little celestial.

- Clear space: the height of the star on all sides.
- Minimum size: 16 px (symbol), 96 px wide (horizontal lockup).
- Never: recolour the star outside the palette system, stretch,
  rotate (other than the built-in orbit tilt), add shadows, or set
  the wordmark in another typeface.

## Logo files (`logo/`)

| File | Use |
|---|---|
| `logo-symbol.svg` | App icon, favicon, avatar, watermarks |
| `logo-color.svg` | Horizontal lockup for light backgrounds |
| `logo-dark.svg` | Horizontal lockup for dark backgrounds |
| `logo-mono.svg` | One-colour (ink) — print, embossing, legal |
| `logo-mono-light.svg` | One-colour (ivory) — dark print, foil |
| `logo-stacked.svg` | Stacked lockup, light backgrounds |
| `logo-stacked-dark.svg` | Stacked lockup, dark backgrounds |

SVG wordmarks use live text in the brand fonts — convert text to
outlines before sending files to print houses without the fonts.

## Colour

Six owner-selectable storefront palettes, each in light + dark mode,
all WCAG AA-verified for text: **Maison Classic** (the original
identity — warm ivory, ink, antique gold), **Aurora Dawn**,
**Tropical Glow**, **Cosmic Candy**, **Emerald & Gold**,
**Electric Blue**. Full token tables: `COLORS.md`. The owner switches
palettes live from the admin panel (Storefront theme).

## Typography

- **Display (Latin):** Playfair Display — headlines, prices, wordmark.
- **Display (Arabic):** Amiri — a true naskh display face.
- **Text (Latin):** Inter. **Text (Arabic):** IBM Plex Sans Arabic.
- All four are self-hosted (Fontsource) — the store never calls a
  font CDN. Fallbacks: Georgia/serif for display, system sans for text.

## Tagline

| Language | Tagline |
|---|---|
| English | Digital products, delivered among the stars. |
| العربية | منتجات رقمية تصلُك بين النجوم. |
| Français | Des produits numériques, livrés parmi les étoiles. |
| Español | Productos digitales, entregados entre las estrellas. |
| Deutsch | Digitale Produkte, geliefert zwischen den Sternen. |

## Voice

Warm, precise, quietly luxurious — a maison concierge, never a hype
merchant. We speak of craft, instant delivery and guarantees in plain
words and let the products shine. We never shout, fake scarcity, use
slang, or drown copy in adjectives. Arabic mirrors the same register:
دافئة ودقيقة وفاخرة بهدوء.

## Templates (`templates/`)

- `email.html` — branded transactional email shell (the store's
  receipt email uses the same identity in `src/services/email.ts`).
- `cover-classic.svg`, `cover-aurora.svg`, `cover-emerald.svg` —
  product-cover templates (storefront covers are CSS-generated from
  the same duotone system in `src/components/Cover.tsx`).
- `og-template.md` — how share images are produced (live `next/og`
  routes) and how to restyle them.

## Social kit (`social/`)

- `profile.png` 1024×1024 — profile/avatar (Instagram, Facebook).
- `profile-whatsapp.png` 640×640 — WhatsApp Business profile.
- `cover-facebook.png` 1640×924 — Facebook page cover.
- `cover-instagram.png` 1080×1080 — Instagram square post/profile grid.
