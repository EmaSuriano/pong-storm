# Pongstorm

Wild 1v1 browser Pong with superpowers and multiple balls.

Host a room, share the link, first to 7.

**Play:** https://emasuriano.github.io/pong-storm/

## How to play

- **Host** paddle is on the left (green). **Joiner** paddle is on the right (gold).
- Move with **WASD** or **arrow keys**.
- **Space** or **J**: hold to charge a smash, release, then the next paddle hit launches a faster, brighter smash.
- If a ball leaves the left edge, the joiner scores; right edge, the host scores. That ball resets and serves toward the scorer's opponent after a short delay.
- First to **7** wins.
- When the scoreline first reaches about **2-2**, a second ball storms in. More balls spawn as the storm grows, cap **6**.

### Powers

Pickups spawn on the table. The last player to hit the ball that collects a pickup gets that power (one slot).

| Power | Effect |
| --- | --- |
| **Split** | Next paddle hit fires an extra ball (respects the 6-ball cap) |
| **Smash** | Next hit is an auto-smash, even without charging |
| **Giant** | Paddle height about 1.7x for about 6 seconds |
| **Curve** | Next outgoing ball gets a vertical curve for a few seconds |
| **Ghost** | Next outgoing ball is dim; opponent collision is slightly late/thin for about 4 seconds |

## Two-tab test

```bash
npm install
npm run dev
```

1. Open http://localhost:3000
2. Click **Create Game**, copy the share link
3. Paste that URL into a second tab
4. Play. Host owns the simulation; the joiner dead-reckons balls between snapshots.

WebRTC will not work from a file URL. Always use the Vite dev server (or any http / https origin). Closing the host tab ends the match. There is no TURN server.

## Stack

| Piece | Role |
| --- | --- |
| Vite | Dev server and bundler |
| TypeScript | Strict types (tsc noEmit) |
| Kaplay | 2D canvas game loop, input, draw |
| @trystero-p2p/mqtt | P2P rooms: MQTT signaling, then WebRTC |

There is no game server. src/net.ts joins a Trystero room namespaced by APP_ID (pong-storm). The host integrates paddles, balls, scoring, and pickups, then broadcasts a world snapshot at about 20 Hz. Each peer sends paddle input only ({ up, down, charging }) at about 20 Hz. Joiners dead-reckon balls between snapshots. No game server.

## Scripts

Vite: dev server on port 3000, build into dist, preview the production bundle, and typecheck with tsc.

## Deploy

Pushes to main publish GitHub Pages at https://emasuriano.github.io/pong-storm/. The workflow sets the Vite public base to /pong-storm/. Local development still uses /.

Repo Settings, Pages, Source = GitHub Actions.

## License

MIT. Free and open source.
