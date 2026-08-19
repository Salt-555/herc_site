# <scene-path> — <short human title>

> One-paragraph description of what this scene IS, as seen by a viewer.
> What does the camera show? What is the mood/state? Keep it about the
> scene, not the implementation.

## Graph position

- **Parent:** `<parent-scene-id or "none">`
- **Children:** `<child-id, child-id, ... or "none">`
- **Terminal kind:** `idle` | `menu` | `game` | `fork`

> `idle` = the wide root shot / base pose. `menu` = letterboxed menu in a
> zoomed region. `game` = mounts an interactive module (see `arcade.js`).
> `fork` = a node that is itself a branch point into a deeper subtree.

## Interactable

| Click target | Leads to (branch) | Terminal kind | Notes |
|---|---|---|---|
| e.g. the TV | `idle/tv` | menu | zoom into the TV → VHS buy/rent menu |

> Targets and exact hotspot rects are authoritative in `scenes.json`.
> List intent here, not pixel coordinates.

## Build-out options

> The "option manual" for this node — potential branches a future build
> (or agent) could add. Check off as they land.
>
> - [ ] Example: click the soda can → zoom in → reveal an underground ant
>       blackjack den → full playable blackjack game there.

## Assets

> Brief notes only. Exact paths live in `scenes.json`.
> Mention anything notable: which clips, audio, alpha.

## Authoring & seam notes

> Stitch contract: the LAST frame of the parent clip must match the FIRST
> frame of this node's base clip (pose + resolution + framerate). Note the
> mask: custom or inherited from nearest ancestor. Note any audio source.
