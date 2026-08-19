# idle/cabinet — Game cabinet zoom / Asteroach

Clicking the game cabinet in the wide shot plays a zoom clip that travels INTO
the cabinet screen. The camera ends zoomed-in on the cabinet, which mounts the
**Asteroach** arcade game (an Asteroids-style roach shooter). This is a
**game terminal**: it does NOT return to the idle pose; only Go Back exits the
cabinet and returns to the wide shot.

## Graph position

- **Parent:** `idle`
- **Children:** none
- **Terminal kind:** `game`

## Interactable

| Click target | Leads to (branch) | Terminal kind | Notes |
|---|---|---|---|
| (arcade controls) | in-game | game | Asteroach — WASD/arrows move, Space/click fire, Esc to cabinet menu, Go Back exits |

## Build-out options

- [ ] Add more cabinet games selectable from an in-cabinet menu (same
      `arcade.js` module pattern as Asteroach).
- [ ] Generalize the game-leaf concept: any fork can terminate in a playable
      module (e.g. the ant blackjack den → full blackjack game).

## Assets

- base: cabinet zoom clip (ends framed on the cabinet screen).
- mask: cabinet zoom mask — geometry differs from the idle mask (custom, not
  inherited).

## Authoring & seam notes

Seam contract: the LAST frame of the idle→cabinet zoom must match this node's
first frame. First ~25% of the zoom keeps idle layers visible for continuity,
then hides them so the transparent cabinet screen doesn't reveal the idle
scene recursively. The arcade canvas is positioned per the zoom clip's
coordinates; do not reintroduce clip-path cropping on the arcade surface.
