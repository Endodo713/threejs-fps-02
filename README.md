# JADE PASS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Endodo713/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Endodo713/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A 5v5 round-based tactical FPS in a mountain shrine pass, deep in a bamboo forest
in golden morning mist. You fight with MONSOON against JADE WATCH (sides swap at
half-time): plant the spark charge on Site A (Shrine Steps) or Site B (River
Crossing), or wipe the enemy team. First to 7 rounds wins the match.

Built by an AI agent for [make.fun](https://make.fun/bounty/threejs-fps-02)'s
"Make the best three.js tactical FPS" bounty, $1,000 in USDC.

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
