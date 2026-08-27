# Kaplay Coop Starter

The smallest working peer-to-peer coop game you can fork: a Vite + TypeScript template that puts two players on a Kaplay canvas, connected through Trystero over MQTT signaling and WebRTC. Host a room, share the link, walk around.

**Demo:** [emasuriano.github.io/kaplay-coop-starter](https://emasuriano.github.io/kaplay-coop-starter/)

## Features

- Room links — create a room, copy the URL, anyone with the link joins
- MQTT signaling via `@trystero-p2p/mqtt` (public brokers; no game server)
- Position sync and a one-shot color handshake between peers
- TypeScript + Vite, strict types, one-command local preview

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), click **Create Room**, then paste the share link into a second tab. Move with WASD or arrow keys.

WebRTC will not work from a `file://` URL. Always use the Vite dev server (or any `http://` / `https://` origin).

## Use as a template

1. Use this repo as a GitHub template, or clone it and delete `.git`.
2. **Change `APP_ID` in `src/config.ts` to something unique.** Trystero rooms are namespaced by `appId`. If two apps share the same `appId`, their rooms can collide — players from unrelated games may see each other. This starter ships `kaplay-coop-starter` (not the old demo id `claude-coop-pixel-demo-v1`); still pick your own before you ship.
3. Rename `package.json` (`name`, `description`) to match your game.
4. Replace `src/game.ts` with your game. Keep `src/net.ts` unless you change signaling.

## Stack

| Piece | Role |
| --- | --- |
| [Vite](https://vitejs.dev/) | Dev server and bundler |
| [TypeScript](https://www.typescriptlang.org/) | Strict types, `tsc --noEmit` |
| [Kaplay](https://kaplayjs.com/) | 2D canvas game loop, sprites, input |
| [@trystero-p2p/mqtt](https://www.npmjs.com/package/@trystero-p2p/mqtt) | P2P rooms: MQTT signaling, then WebRTC |

## Project structure

```
.
├── .github/workflows/  # CI on PRs, GitHub Pages deploy on main
├── index.html          # Lobby overlay + game canvas (stable element ids)
├── package.json        # Scripts and dependencies
├── tsconfig.json       # Strict TypeScript (noEmit, bundler resolution)
├── vite.config.ts      # Dev server on port 3000, host + strictPort
├── LICENSE             # MIT
├── README.md
└── src/
    ├── main.ts         # Lobby flow: create / join room, wire the canvas
    ├── game.ts         # Kaplay scene, movement, peer sprites, sync
    ├── net.ts          # joinRoom / genCode / shareLink helpers
    ├── config.ts       # APP_ID, canvas size, colors, speed
    ├── style.css       # Overlay, HUD, and canvas styles
    └── vite-env.d.ts   # Vite client type reference
```

## How multiplayer works

There is no game server. `connectRoom` calls Trystero `joinRoom({ appId }, roomCode, { onJoinError })`. The host generates a 6-character code and puts it in `?room=` on the share URL; joiners open that link (`isHost = !room` query param).

Once the room exists, `game.ts` creates two typed actions: `hello` (color handshake) and `pos` (`{ x, y }` at ~20 Hz). Each peer has a local sprite; remote peers are spawned on `onPeerJoin` (and seeded from `getPeers()` if someone is already there). MQTT public brokers are used only for signaling — after that, browsers talk WebRTC peer-to-peer.

WebRTC needs a real origin (`http://localhost` or `https://`). Two tabs on the same machine is the easiest test. Restrictive NATs or firewalls may need a TURN server later; this starter does not ship one.

## Scripts

| Script | Command |
| --- | --- |
| `npm run dev` | Vite dev server at http://localhost:3000 |
| `npm run build` | Production bundle into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` |

## Customize

Edit these first:

- **`src/config.ts`** — unique `APP_ID`, canvas size, grid, speed, host/join colors
- **`src/game.ts`** — sprites, movement, and anything you sync over the wire
- **`index.html`** — lobby copy and layout (keep the element ids `main.ts` queries)
- **`src/style.css`** — overlay, HUD, and canvas look

Leave `src/net.ts` alone unless you swap the Trystero strategy or signaling.

## Deploy

Pushes to `main` build the site and publish it to GitHub Pages:

https://emasuriano.github.io/kaplay-coop-starter/

The live origin is `https`, which WebRTC needs. GitHub Actions sets `VITE_BASE=/kaplay-coop-starter/` so asset URLs work on the project Pages path. Local `npm run dev` still uses `/`.

First time (or after forking): repo **Settings → Pages → Source = GitHub Actions**. Forks should change `VITE_BASE` in `.github/workflows/pages.yml` to `/<their-repo-name>/`.

## License

MIT
