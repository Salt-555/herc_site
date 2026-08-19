# idle — Wide shop shot

The root scene: the wide establishing shot of Gaylord's shop interior. This is
the base pose every branch originates from and the "home" the viewer returns
to via Go Back. The character stands against the shop with the TV and the game
cabinet visible on screen — their screens show through alpha holes in the
character layer.

## Graph position

- **Parent:** none
- **Children:** `idle/tv`, `idle/cabinet`
- **Terminal kind:** `idle`

## Interactable

| Click target | Leads to (branch) | Terminal kind | Notes |
|---|---|---|---|
| the TV | `idle/tv` | menu | zoom into the TV → VHS buy/rent menu |
| the game cabinet | `idle/cabinet` | game | zoom into the cabinet → Asteroach |

## Build-out options

- [ ] Add more clickable items in the shot that zoom into their own scene
      (a fork branch), e.g.:
      - [ ] the soda can → zoom in → reveal an underground ant blackjack den
            → full playable blackjack game there.
- [ ] Add idle speech / ambient clips as new extras (start/end on the shared
      base pose per the idle seam rule).

## Assets

- base: idle loop (alpha-masked character with TV + cabinet holes).
- extras: idle speech clips, all sharing the base pose for seamless cuts.
- mask: `TVMask` equivalent — the TV + cabinet holes.

## Authoring & seam notes

Idle clips all START and END on this same base pose so random cuts are
invisible. Character media is alpha-masked (VP9 WebM). The mask for this root
carries the TV + cabinet holes; the zoom children override it with their own
masks.
