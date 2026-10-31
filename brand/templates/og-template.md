# Open Graph / share-image templates

Share images are **not static files** in this store — they are
rendered live by `next/og` (Satori) routes, so every product and page
gets a correct, current card with zero asset management:

| Route | File | Size |
|---|---|---|
| `/{locale}/opengraph-image` | `src/app/[locale]/opengraph-image.tsx` | 1200×630 |
| `/{locale}/product/{slug}/opengraph-image` | `src/app/[locale]/product/[slug]/opengraph-image.tsx` | 1200×630 |

Identity used: ivory ground, ink text, antique-gold double rule, the
✦ mark and the locale's tagline (store card); the product's own
duotone cover colours and price (product card). To restyle, edit the
two components — colours come from the maison palette constants at
the top of each file; keep text contrast ≥ 4.5:1 on the card ground.

For one-off campaign images outside the store, start from
`cover-*.svg` in this folder (1200×630 viewBox versions can be made
by changing the viewBox and re-centring the frame) or from the
Facebook cover raster in `../social/cover-facebook.png`.
