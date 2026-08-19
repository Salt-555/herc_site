# idle/tv — TV zoom / VHS menu

Clicking the TV in the wide shot plays a zoom clip that travels INTO the TV
screen. The camera ends zoomed-in on the TV — a letterboxed VHS-style menu for
**HERCULES RECYCLED 2.0** with a buy/rent prompt linking to the Amazon Prime
Video listing. This is a **menu terminal**: it does NOT return to the idle
pose; only Go Back returns to the wide shot.

## Graph position

- **Parent:** `idle`
- **Children:** none
- **Terminal kind:** `menu`

## Interactable

| Click target | Leads to (branch) | Terminal kind | Notes |
|---|---|---|---|
| Buy / Rent (Amazon) | external link | — | Amazon Prime Video listing |

## Build-out options

- [ ] Turn this menu node into a fork: add deeper branches from inside the
      VHS menu (e.g. a "trailer" branch that plays a clip inside the TV).
- [ ] Add a second TV channel/scene reachable from idle.

## Assets

- base: TV zoom clip (ends framed on the TV screen).
- mask: TV zoom mask — the geometry differs from the idle mask because the
  camera is inside/near the TV screen (custom, not inherited).

## Authoring & seam notes

Seam contract: the LAST frame of the idle→TV zoom must match this node's first
frame. During the first ~25% of the zoom the idle layers stay visible for
continuity; after that they are hidden so the transparent TV close-up doesn't
reveal the idle scene recursively.
