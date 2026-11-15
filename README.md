# JADE PASS

A 5v5 round-based tactical FPS in a mountain shrine pass, deep in a bamboo forest
in golden morning mist. You fight with MONSOON against JADE WATCH (sides swap at
half-time): plant the spark charge on Site A (Shrine Steps) or Site B (River
Crossing), or wipe the enemy team. First to 7 rounds wins the match.

## How to run

```sh
node serve.ts
```

Then open http://localhost:8080 in a browser.

To build the submission dossier:

```sh
node main.ts
```

## Controls

- **Mouse** — look (click to capture the pointer)
- **W A S D** — move, **Space** — jump, **C / Ctrl** — crouch
- **Left click** — fire (hold for automatic weapons)
- **1 / 2 / 3** — weapon slots, **R** — reload, **Mouse wheel** — cycle weapons
- **4 / 5 / 6** — select Thunder / Mist / Dawn grenade, **G** — throw
- **E** (hold) — plant the spark charge / defuse it, near a site
- **B** — buy menu (buy phase)
- **Esc** — pause

## Economy

Start with $800. Kills pay $300, round wins $3250, losses $1900, planting or
defusing pays $300. Buy rifles, SMGs, a DMR, armour, a helmet, a defuse kit and
grenades between rounds — weapons you keep while you stay alive.

## Deterministic captures

`?shot=start|play|end|plant&seed=1` renders a fixed frame for screenshots.
