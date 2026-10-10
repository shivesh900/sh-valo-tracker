# SH VALO TRACKER

A fan-made Valorant companion that installs on your phone like an app.

**Live:** https://shivesh900.github.io/sh-valo-tracker/

## What's inside
- **Player lookup**: type any Riot ID (name#tag) to see rank, RR, peak rank, act stats (K/D, headshot %, win rate, ACS), most-played agents and the last 10 matches. Share a lookup with a link like `?id=Name%231234&r=ap`. Recent searches are remembered on your device.
- **Agents**: filter by role; each agent page has the portrait, bio and all abilities with icons.
- **Maps**: splash art, minimaps with callout labels, and callout lists by site.
- **Weapons**: sortable stats table (cost, fire rate, magazine, head/body/leg damage per range band) and a skins gallery per gun.
- **Comp builder**: pick a map and five agents, get role-balance hints, save comps and share them by link.
- **Crosshairs**: pro-style crosshair codes with live canvas previews drawn from the code, a copy button, and a box to preview and save any code.
- **Ranks**: every competitive tier from Iron 1 to Radiant.

## Install as an app
Android (Chrome): open the site and tap **Install app** (or ⋮ → Install app). iPhone (Safari): Share → Add to Home Screen.
It works offline with the last data it loaded.

## Data
- Game data: [valorant-api.com](https://valorant-api.com), fetched live, with a bundled snapshot in `data/snapshot.json` so the app still works if the API is down.
- Player stats: by default from dak.gg's public stats backend (no key needed; unofficial, so it can change). Optionally the HenrikDev API through the key-holding proxy in `proxy/henrik-worker.js`. See `js/config.js`. Never commit an API key here.

## Code
Plain HTML, CSS and JavaScript modules; no build step. `sw.js` is the service worker, `manifest.webmanifest` the app manifest.

---
SH VALO TRACKER is fan-made and not endorsed by Riot Games. Valorant and all related assets are property of Riot Games, Inc.
