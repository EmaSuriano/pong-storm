import kaplay from 'kaplay'
import type { Room } from '@trystero-p2p/mqtt'
import {
  WIDTH,
  HEIGHT,
  WIN_SCORE,
  HOST_COLOR,
  JOIN_COLOR,
  PADDLE_W,
  PADDLE_H,
  PADDLE_SPEED,
  BALL_R,
  BALL_SPEED,
  BALL_SPEED_MAX,
  HIT_SPEEDUP,
  SMASH_MULT,
  MAX_BALLS,
  CHARGE_S,
  GIANT_MULT,
  GIANT_S,
  CURVE_S,
  GHOST_S,
  SERVE_DELAY_MS,
  INPUT_MS,
  WORLD_MS,
} from './config'

type PlayerId = 'host' | 'peer'
type PickupKind = 'split' | 'smash' | 'giant' | 'curve' | 'ghost'

type PaddleInput = {
  up: boolean
  down: boolean
  charging: boolean
  smashReleased: boolean
}

type PaddleSnap = {
  y: number
  h: number
  charging: boolean
  charge: number
}

type BallSnap = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  smash?: boolean
  ghost?: boolean
  curve?: boolean
}

type PickupSnap = {
  id: number
  x: number
  y: number
  kind: PickupKind
}

type WorldMsg = {
  started: boolean
  over: boolean
  scores: { host: number; peer: number }
  paddles: { host: PaddleSnap; peer: PaddleSnap }
  balls: BallSnap[]
  pickups: PickupSnap[]
  slots: { host: PickupKind | null; peer: PickupKind | null }
}

type HelloMsg = { role: PlayerId }

type SimPaddle = {
  y: number
  h: number
  charging: boolean
  charge: number
  smashArmed: boolean
  giantUntil: number
  input: PaddleInput
}

type SimBall = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  smash: boolean
  ghost: boolean
  ghostUntil: number
  curve: boolean
  curveUntil: number
  curveAccel: number
  lastHit: PlayerId | null
  waiting: boolean
  serveAt: number
  serveDir: number
}

type SimPickup = {
  id: number
  x: number
  y: number
  kind: PickupKind
}

type BcMsg =
  | { t: 'here'; role: PlayerId }
  | { t: 'world'; world: WorldMsg }
  | { t: 'input'; input: PaddleInput }

const PICKUP_KINDS: PickupKind[] = ['split', 'smash', 'giant', 'curve', 'ghost']
const HOST_X = 28
const PEER_X = WIDTH - 28 - PADDLE_W
const PICKUP_R = 12

export function startGame(
  room: Room,
  opts: {
    isHost: boolean
    canvas: HTMLCanvasElement
    peerCountEl: HTMLElement
    roomCode: string
    shareBar?: HTMLElement
  },
): void {
  const { isHost, canvas, peerCountEl, roomCode, shareBar } = opts
  const myId: PlayerId = isHost ? 'host' : 'peer'
  let bc: BroadcastChannel | null = null

  const k = kaplay({
    global: false,
    width: WIDTH,
    height: HEIGHT,
    letterbox: true,
    background: [8, 12, 22],
    crisp: true,
    canvas,
  })

  const helloAction = room.makeAction<HelloMsg>('hello')
  const inputAction = room.makeAction<PaddleInput>('input')
  const worldAction = room.makeAction<WorldMsg>('world')

  const peers = new Set<string>()

  function hexColor(hex: string) {
    if (k.Color && typeof k.Color.fromHex === 'function') {
      return k.Color.fromHex(hex)
    }
    const n = String(hex).replace('#', '')
    const r = parseInt(n.slice(0, 2), 16) || 0
    const g = parseInt(n.slice(2, 4), 16) || 0
    const b = parseInt(n.slice(4, 6), 16) || 0
    return k.rgb(r, g, b)
  }

  function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n))
  }

  function nowMs(): number {
    return performance.now()
  }

  function randRange(lo: number, hi: number): number {
    return lo + Math.random() * (hi - lo)
  }

  function emptyInput(): PaddleInput {
    return { up: false, down: false, charging: false, smashReleased: false }
  }

  function makePaddle(y: number): SimPaddle {
    return {
      y,
      h: PADDLE_H,
      charging: false,
      charge: 0,
      smashArmed: false,
      giantUntil: 0,
      input: emptyInput(),
    }
  }

  const hostPad = makePaddle((HEIGHT - PADDLE_H) / 2)
  const peerPad = makePaddle((HEIGHT - PADDLE_H) / 2)
  let scores = { host: 0, peer: 0 }
  let balls: SimBall[] = []
  let pickups: SimPickup[] = []
  let slots: { host: PickupKind | null; peer: PickupKind | null } = {
    host: null,
    peer: null,
  }
  let started = false
  let over = false
  let nextBallId = 1
  let nextPickupId = 1
  let lastPickupAt = 0
  let pickupGap = 6500
  let localY = (HEIGHT - PADDLE_H) / 2
  let smashPulse = false
  let lastInputSent = 0
  let lastWorldSent = 0
  let lastSim = nowMs()
  let rainT = 0
  let flash = 0
  let stormSpawned = 1

  const rain = Array.from({ length: 42 }, () => ({
    x: Math.random() * WIDTH,
    y: Math.random() * HEIGHT,
    len: 8 + Math.random() * 14,
    spd: 180 + Math.random() * 220,
  }))

  function padOf(id: PlayerId): SimPaddle {
    return id === 'host' ? hostPad : peerPad
  }

  function paddleX(id: PlayerId): number {
    return id === 'host' ? HOST_X : PEER_X
  }

  function snapPad(p: SimPaddle): PaddleSnap {
    return { y: p.y, h: p.h, charging: p.charging || p.smashArmed, charge: p.charge }
  }

  function snapshot(): WorldMsg {
    return {
      started,
      over,
      scores: { host: scores.host, peer: scores.peer },
      paddles: { host: snapPad(hostPad), peer: snapPad(peerPad) },
      balls: balls.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        vx: b.waiting ? 0 : b.vx,
        vy: b.waiting ? 0 : b.vy,
        smash: b.smash,
        ghost: b.ghost,
        curve: b.curve,
      })),
      pickups: pickups.map((p) => ({ id: p.id, x: p.x, y: p.y, kind: p.kind })),
      slots: { host: slots.host, peer: slots.peer },
    }
  }

  function sendWorld(): void {
    if (!isHost) return
    const msg = snapshot()
    worldAction.send(msg)
    bcSend({ t: 'world', world: msg })
    lastWorldSent = nowMs()
  }

  function setShareBar(on: boolean): void {
    if (!shareBar) return
    if (on && isHost) shareBar.classList.add('show')
    else shareBar.classList.remove('show')
  }

  function spawnBall(dir: number, delay: number, extra = false): SimBall {
    const ang = randRange(-0.42, 0.42)
    const b: SimBall = {
      id: nextBallId++,
      x: WIDTH / 2,
      y: extra ? randRange(70, HEIGHT - 70) : HEIGHT / 2,
      vx: 0,
      vy: 0,
      smash: false,
      ghost: false,
      ghostUntil: 0,
      curve: false,
      curveUntil: 0,
      curveAccel: 0,
      lastHit: null,
      waiting: true,
      serveAt: nowMs() + delay,
      serveDir: dir < 0 ? -1 : 1,
    }
    b.vx = Math.cos(ang) * BALL_SPEED * b.serveDir
    b.vy = Math.sin(ang) * BALL_SPEED
    balls.push(b)
    return b
  }

  function beginMatch(): void {
    if (started) return
    started = true
    over = false
    scores = { host: 0, peer: 0 }
    balls = []
    pickups = []
    slots = { host: null, peer: null }
    stormSpawned = 1
    lastPickupAt = nowMs()
    pickupGap = 5500
    spawnBall(Math.random() < 0.5 ? -1 : 1, 700)
    setShareBar(false)
    sendWorld()
  }

  function pauseMatch(): void {
    if (over) return
    started = false
    balls = []
    pickups = []
    setShareBar(true)
    sendWorld()
  }

  function liveH(p: SimPaddle, t: number): number {
    return t < p.giantUntil ? PADDLE_H * GIANT_MULT : PADDLE_H
  }

  function movePaddle(p: SimPaddle, dt: number, t: number): void {
    p.h = liveH(p, t)
    let dy = 0
    if (p.input.up) dy -= 1
    if (p.input.down) dy += 1
    p.y = clamp(p.y + dy * PADDLE_SPEED * dt, 0, HEIGHT - p.h)
    if (p.input.charging) {
      p.charging = true
      p.charge = clamp(p.charge + dt / CHARGE_S, 0, 1)
    } else {
      p.charging = false
      if (!p.smashArmed) p.charge = clamp(p.charge - dt * 1.8, 0, 1)
    }
    if (p.input.smashReleased && p.charge >= 0.28) p.smashArmed = true
    p.input.smashReleased = false
  }

  function applyRemoteInput(data: PaddleInput): void {
    if (!isHost) return
    const p = peerPad
    p.input.up = Boolean(data.up)
    p.input.down = Boolean(data.down)
    p.input.charging = Boolean(data.charging)
    if (data.smashReleased) p.input.smashReleased = true
  }

  function ballSpeed(b: SimBall): number {
    return Math.hypot(b.vx, b.vy) || BALL_SPEED
  }

  function launchFromPaddle(b: SimBall, who: PlayerId, t: number): void {
    const p = padOf(who)
    const cy = p.y + p.h / 2
    const rel = clamp((b.y - cy) / (p.h / 2), -1, 1)
    const smash = p.smashArmed || slots[who] === 'smash'
    const split = slots[who] === 'split'
    const curve = slots[who] === 'curve'
    const ghost = slots[who] === 'ghost'
    let spd = Math.min(ballSpeed(b) * HIT_SPEEDUP, BALL_SPEED_MAX)
    if (smash) spd = Math.min(Math.max(spd * SMASH_MULT, BALL_SPEED * 1.35), BALL_SPEED_MAX)
    const ang = rel * 0.85
    const dir = who === 'host' ? 1 : -1
    b.vx = Math.cos(ang) * spd * dir
    b.vy = Math.sin(ang) * spd
    b.x = who === 'host' ? paddleX(who) + PADDLE_W + BALL_R + 1 : paddleX(who) - BALL_R - 1
    b.lastHit = who
    b.smash = smash
    if (smash) {
      p.smashArmed = false
      p.charge = 0
      if (slots[who] === 'smash') slots[who] = null
    }
    if (curve) {
      b.curve = true
      b.curveUntil = t + CURVE_S * 1000
      b.curveAccel = (rel === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(rel)) * 260
      slots[who] = null
    }
    if (ghost) {
      b.ghost = true
      b.ghostUntil = t + GHOST_S * 1000
      slots[who] = null
    }
    if (split) {
      slots[who] = null
      if (balls.length < MAX_BALLS) {
        const extra: SimBall = {
          ...b,
          id: nextBallId++,
          vy: -b.vy || randRange(-140, 140),
          waiting: false,
        }
        balls.push(extra)
      }
    }
  }

  function hitsPaddle(b: SimBall, who: PlayerId): boolean {
    const p = padOf(who)
    const px = paddleX(who)
    let top = p.y
    let h = p.h
    let late = 0
    if (b.ghost) {
      const shrink = h * 0.18
      top += shrink
      h -= shrink * 2
      late = 5
    }
    if (b.y < top - BALL_R || b.y > top + h + BALL_R) return false
    if (who === 'host') {
      return b.vx < 0 && b.x - BALL_R <= px + PADDLE_W + late && b.x + BALL_R >= px
    }
    return b.vx > 0 && b.x + BALL_R >= px - late && b.x - BALL_R <= px + PADDLE_W
  }

  function bounceWalls(b: SimBall): void {
    if (b.y - BALL_R < 0) {
      b.y = BALL_R
      b.vy = Math.abs(b.vy)
    } else if (b.y + BALL_R > HEIGHT) {
      b.y = HEIGHT - BALL_R
      b.vy = -Math.abs(b.vy)
    }
  }

  function grantPickup(who: PlayerId, kind: PickupKind, t: number): void {
    if (kind === 'giant') {
      padOf(who).giantUntil = t + GIANT_S * 1000
      return
    }
    slots[who] = kind
  }

  function maybeScore(b: SimBall, t: number): void {
    if (b.waiting || over) return
    if (b.x < 0) {
      scores.peer += 1
      resetBall(b, -1, t)
    } else if (b.x > WIDTH) {
      scores.host += 1
      resetBall(b, 1, t)
    }
    if (scores.host >= WIN_SCORE || scores.peer >= WIN_SCORE) {
      over = true
      for (const x of balls) {
        x.vx = 0
        x.vy = 0
        x.waiting = true
      }
    }
  }

  function resetBall(b: SimBall, toward: number, t: number): void {
    b.x = WIDTH / 2
    b.y = HEIGHT / 2
    b.smash = false
    b.ghost = false
    b.curve = false
    b.lastHit = null
    b.waiting = true
    b.serveAt = t + SERVE_DELAY_MS
    b.serveDir = toward
    const ang = randRange(-0.42, 0.42)
    b.vx = Math.cos(ang) * BALL_SPEED * toward
    b.vy = Math.sin(ang) * BALL_SPEED
  }

  function targetBallCount(): number {
    const total = scores.host + scores.peer
    const least = Math.min(scores.host, scores.peer)
    if (total < 4 || least < 2) return 1
    return clamp(2 + Math.floor((total - 4) / 2), 2, MAX_BALLS)
  }

  function maybeStorm(): void {
    const want = targetBallCount()
    while (balls.length < want) {
      spawnBall(Math.random() < 0.5 ? -1 : 1, 280, true)
    }
    stormSpawned = Math.max(stormSpawned, balls.length)
  }

  function maybeSpawnPickup(t: number): void {
    if (!started || over) return
    if (pickups.length >= 2) return
    if (t - lastPickupAt < pickupGap) return
    lastPickupAt = t
    pickupGap = 5200 + Math.random() * 3800
    const kind: PickupKind = PICKUP_KINDS[Math.floor(Math.random() * PICKUP_KINDS.length)] ?? 'split'
    pickups.push({
      id: nextPickupId++,
      x: randRange(WIDTH * 0.36, WIDTH * 0.64),
      y: randRange(56, HEIGHT - 56),
      kind,
    })
  }

  function collectPickups(b: SimBall, t: number): void {
    if (!b.lastHit) return
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i]
      if (!p) continue
      const dx = b.x - p.x
      const dy = b.y - p.y
      if (dx * dx + dy * dy <= (BALL_R + PICKUP_R) * (BALL_R + PICKUP_R)) {
        grantPickup(b.lastHit, p.kind, t)
        pickups.splice(i, 1)
      }
    }
  }

  function stepBall(b: SimBall, dt: number, t: number, collide: boolean): void {
    if (b.waiting) {
      if (t >= b.serveAt && started && !over) {
        b.waiting = false
      } else {
        return
      }
    }
    if (b.curve && t < b.curveUntil) b.vy += b.curveAccel * dt
    else b.curve = false
    if (b.ghost && t >= b.ghostUntil) b.ghost = false
    b.x += b.vx * dt
    b.y += b.vy * dt
    bounceWalls(b)
    if (!collide) return
    if (hitsPaddle(b, 'host')) launchFromPaddle(b, 'host', t)
    else if (hitsPaddle(b, 'peer')) launchFromPaddle(b, 'peer', t)
    collectPickups(b, t)
    maybeScore(b, t)
  }

  function tickHost(dt: number): void {
    if (!isHost) return
    const t = nowMs()
    movePaddle(hostPad, dt, t)
    movePaddle(peerPad, dt, t)
    if (!started || over) return
    const sub = Math.max(1, Math.ceil(dt / 0.008))
    const slice = dt / sub
    for (let s = 0; s < sub; s++) {
      for (const b of balls) stepBall(b, slice, t, true)
    }
    maybeStorm()
    maybeSpawnPickup(t)
  }

  function applyWorld(data: WorldMsg): void {
    if (!data || isHost) return
    started = Boolean(data.started)
    over = Boolean(data.over)
    if (data.scores) scores = { host: data.scores.host, peer: data.scores.peer }
    if (data.slots) slots = { host: data.slots.host, peer: data.slots.peer }
    if (data.started) setShareBar(false)
    if (data.paddles) {
      hostPad.y = data.paddles.host.y
      hostPad.h = data.paddles.host.h
      hostPad.charging = data.paddles.host.charging
      hostPad.charge = data.paddles.host.charge
      peerPad.h = data.paddles.peer.h
      peerPad.charging = data.paddles.peer.charging
      peerPad.charge = data.paddles.peer.charge
      localY = localY * 0.82 + data.paddles.peer.y * 0.18
      peerPad.y = localY
    }
    if (Array.isArray(data.pickups)) {
      pickups = data.pickups.map((p) => ({ id: p.id, x: p.x, y: p.y, kind: p.kind }))
    }
    if (!Array.isArray(data.balls)) return
    const keep = new Map<number, SimBall>()
    for (const b of balls) keep.set(b.id, b)
    const next: SimBall[] = []
    for (const s of data.balls) {
      const old = keep.get(s.id)
      const nb: SimBall = old ?? {
        id: s.id,
        x: s.x,
        y: s.y,
        vx: s.vx,
        vy: s.vy,
        smash: Boolean(s.smash),
        ghost: Boolean(s.ghost),
        ghostUntil: 0,
        curve: Boolean(s.curve),
        curveUntil: 0,
        curveAccel: 0,
        lastHit: null,
        waiting: false,
        serveAt: 0,
        serveDir: s.vx >= 0 ? 1 : -1,
      }
      if (old) {
        nb.x = old.x * 0.62 + s.x * 0.38
        nb.y = old.y * 0.62 + s.y * 0.38
      } else {
        nb.x = s.x
        nb.y = s.y
      }
      nb.vx = s.vx
      nb.vy = s.vy
      nb.smash = Boolean(s.smash)
      nb.ghost = Boolean(s.ghost)
      nb.curve = Boolean(s.curve)
      nb.waiting = s.vx === 0 && s.vy === 0
      next.push(nb)
    }
    balls = next
  }

  function refreshPeerCount(): void {
    peerCountEl.textContent = String(peers.size)
  }

  function greetPeer(peerId: string): void {
    peers.add(peerId)
    refreshPeerCount()
    helloAction.send({ role: myId }, { target: peerId })
    if (isHost) beginMatch()
  }

  room.onPeerJoin = (peerId) => {
    greetPeer(peerId)
  }

  room.onPeerLeave = (peerId) => {
    peers.delete(peerId)
    refreshPeerCount()
    if (peers.size === 0 && isHost && !over) pauseMatch()
  }

  helloAction.onMessage = (_data, context) => {
    peers.add(context.peerId)
    refreshPeerCount()
    if (isHost) beginMatch()
  }

  inputAction.onMessage = (data, context) => {
    if (!data) return
    peers.add(context.peerId)
    applyRemoteInput(data)
  }

  worldAction.onMessage = (data) => {
    if (data) applyWorld(data)
  }

  try {
    bc = new BroadcastChannel('pong-storm:' + roomCode)
  } catch {
    bc = null
  }

  function bcSend(msg: BcMsg): void {
    try {
      bc?.postMessage(msg)
    } catch {
      /* ignore */
    }
  }

  function pollPeers(): void {
    if (typeof room.getPeers !== 'function') return
    const existing = room.getPeers() || {}
    const ids = Array.isArray(existing) ? existing : Object.keys(existing)
    for (const peerId of ids) {
      if (!peers.has(peerId)) greetPeer(peerId)
    }
  }

  pollPeers()

  if (bc) {
    bc.onmessage = (ev: MessageEvent<BcMsg>) => {
      const msg = ev.data
      if (!msg || typeof msg !== 'object') return
      if (msg.t === 'here' && isHost && msg.role === 'peer') beginMatch()
      if (msg.t === 'world' && !isHost) applyWorld(msg.world)
      if (msg.t === 'input' && isHost) applyRemoteInput(msg.input)
    }
  }

  function shoutHere(): void {
    bcSend({ t: 'here', role: myId })
  }
  shoutHere()
  const hereTimer = window.setInterval(() => {
    if (!started) shoutHere()
  }, 250)

  function readLocalInput(): PaddleInput {
    const up = k.isKeyDown('up') || k.isKeyDown('w')
    const down = k.isKeyDown('down') || k.isKeyDown('s')
    const charging = k.isKeyDown('space') || k.isKeyDown('j')
    const released = smashPulse
    smashPulse = false
    return { up, down, charging, smashReleased: released }
  }

  k.onKeyRelease('space', () => { smashPulse = true })
  k.onKeyRelease('j', () => { smashPulse = true })

  function sendInput(): void {
    const t = nowMs()
    const up = k.isKeyDown('up') || k.isKeyDown('w')
    const down = k.isKeyDown('down') || k.isKeyDown('s')
    const charging = k.isKeyDown('space') || k.isKeyDown('j')
    if (isHost) {
      hostPad.input.up = up
      hostPad.input.down = down
      hostPad.input.charging = charging
      if (smashPulse) {
        hostPad.input.smashReleased = true
        smashPulse = false
      }
    }
    if (t - lastInputSent < INPUT_MS && !smashPulse) return
    lastInputSent = t
    const released = smashPulse
    smashPulse = false
    const inp: PaddleInput = { up, down, charging, smashReleased: released }
    if (isHost) return
    inputAction.send(inp)
    bcSend({ t: 'input', input: inp })
    peerPad.charging = charging
    if (charging) peerPad.charge = clamp(peerPad.charge + INPUT_MS / 1000 / CHARGE_S, 0, 1)
    if (released && peerPad.charge >= 0.28) peerPad.smashArmed = true
  }

  function deadReckon(dt: number): void {
    if (isHost) return
    const t = nowMs()
    for (const b of balls) stepBall(b, dt, t, false)
  }

  function pump(): void {
    pollPeers()
    const now = nowMs()
    const dt = Math.min((now - lastSim) / 1000, 0.05)
    if (dt < 1 / 90) return
    lastSim = now
    rainT += dt
    if (flash > 0) flash -= dt
    else if (started && Math.random() < dt * 0.12) flash = 0.12
    for (const d of rain) {
      d.y += d.spd * dt
      if (d.y > HEIGHT) {
        d.y = -d.len
        d.x = Math.random() * WIDTH
      }
    }
    sendInput()
    if (isHost) {
      tickHost(dt)
      if (now - lastWorldSent >= WORLD_MS) sendWorld()
    } else {
      const inp = {
        up: k.isKeyDown('up') || k.isKeyDown('w'),
        down: k.isKeyDown('down') || k.isKeyDown('s'),
        charging: k.isKeyDown('space') || k.isKeyDown('j'),
        smashReleased: false,
      }
      if (inp.up) localY -= PADDLE_SPEED * dt
      if (inp.down) localY += PADDLE_SPEED * dt
      localY = clamp(localY, 0, HEIGHT - peerPad.h)
      peerPad.y = localY
      deadReckon(dt)
    }
  }
  const pumpTimer = window.setInterval(pump, 50)
  window.addEventListener('visibilitychange', () => {
    shoutHere()
    pump()
    if (isHost) sendWorld()
  })

  function setHud(id: string, text: string): void {
    const el = document.getElementById(id)
    if (el) el.textContent = text
  }

  function kindLabel(kind: PickupKind | null): string {
    if (!kind) return '—'
    return kind
  }

  function paintHud(): void {
    setHud('scoreHost', String(scores.host))
    setHud('scorePeer', String(scores.peer))
    setHud('slotYou', kindLabel(slots[myId]))
  }

  function pickupTint(kind: PickupKind): string {
    if (kind === 'split') return '#7dd3fc'
    if (kind === 'smash') return '#fb923c'
    if (kind === 'giant') return '#86efac'
    if (kind === 'curve') return '#e879f9'
    return '#cbd5e1'
  }

  function drawCourt(): void {
    k.drawRect({ pos: k.vec2(0, 0), width: WIDTH, height: HEIGHT, color: hexColor('#0b1220') })
    k.drawRect({ pos: k.vec2(0, 0), width: WIDTH, height: HEIGHT, color: hexColor('#1e3a5f'), opacity: 0.18 })
    for (const d of rain) {
      k.drawRect({
        pos: k.vec2(d.x, d.y),
        width: 1,
        height: d.len,
        color: hexColor('#8aa4c8'),
        opacity: 0.22,
      })
    }
    if (flash > 0) {
      k.drawRect({ pos: k.vec2(0, 0), width: WIDTH, height: HEIGHT, color: hexColor('#cfe8ff'), opacity: flash * 0.35 })
    }
    k.drawRect({ pos: k.vec2(0, 0), width: WIDTH, height: 4, color: hexColor('#243044') })
    k.drawRect({ pos: k.vec2(0, HEIGHT - 4), width: WIDTH, height: 4, color: hexColor('#243044') })
    for (let y = 12; y < HEIGHT - 12; y += 18) {
      k.drawRect({ pos: k.vec2(WIDTH / 2 - 2, y), width: 4, height: 10, color: hexColor('#3a4d6a'), opacity: 0.85 })
    }
    k.drawText({ text: String(scores.host), pos: k.vec2(WIDTH / 2 - 78, 16), size: 32, color: hexColor(HOST_COLOR) })
    k.drawText({ text: String(scores.peer), pos: k.vec2(WIDTH / 2 + 52, 16), size: 32, color: hexColor(JOIN_COLOR) })
  }

  function drawPaddle(id: PlayerId, color: string): void {
    const p = padOf(id)
    const x = paddleX(id)
    const glow = p.smashArmed || p.charging
    if (glow) {
      k.drawRect({
        pos: k.vec2(x - 4, p.y - 4),
        width: PADDLE_W + 8,
        height: p.h + 8,
        color: hexColor('#fff7d6'),
        opacity: 0.18 + p.charge * 0.35,
      })
    }
    k.drawRect({ pos: k.vec2(x, p.y), width: PADDLE_W, height: p.h, color: hexColor(color) })
    if (p.charge > 0.05) {
      k.drawRect({
        pos: k.vec2(x + 3, p.y + p.h - p.h * p.charge),
        width: PADDLE_W - 6,
        height: p.h * p.charge,
        color: hexColor('#fff1b8'),
        opacity: 0.55,
      })
    }
    const slot = slots[id]
    if (slot) {
      const sx = id === 'host' ? x + PADDLE_W + 10 : x - 22
      k.drawRect({ pos: k.vec2(sx, p.y + p.h / 2 - 8), width: 16, height: 16, color: hexColor(pickupTint(slot)) })
    }
  }

  function drawBall(b: SimBall): void {
    const r = b.smash ? BALL_R + 2 : BALL_R
    let col = '#e7eef8'
    let op = b.waiting ? 0.45 : 1
    if (b.smash) col = '#ffe08a'
    if (b.curve) col = '#f0abfc'
    if (b.ghost) {
      col = '#94a3b8'
      op = 0.32
    }
    k.drawCircle({ pos: k.vec2(b.x, b.y), radius: r, color: hexColor(col), opacity: op })
  }

  function drawPickup(p: SimPickup): void {
    k.drawRect({
      pos: k.vec2(p.x - PICKUP_R, p.y - PICKUP_R),
      width: PICKUP_R * 2,
      height: PICKUP_R * 2,
      color: hexColor(pickupTint(p.kind)),
      opacity: 0.9,
    })
  }

  function drawOverlay(): void {
    if (!started && !over) {
      k.drawRect({ pos: k.vec2(0, 0), width: WIDTH, height: HEIGHT, color: hexColor('#000000'), opacity: 0.45 })
      k.drawText({ text: 'WAITING FOR OPPONENT', pos: k.vec2(0, HEIGHT / 2 - 36), size: 22, align: 'center', width: WIDTH, color: hexColor('#7dd3fc') })
      k.drawText({ text: 'CODE  ' + roomCode.toUpperCase(), pos: k.vec2(0, HEIGHT / 2), size: 18, align: 'center', width: WIDTH, color: hexColor('#e7e9ee') })
    }
    if (over) {
      const winner = scores.host >= WIN_SCORE ? 'HOST WINS' : 'JOINER WINS'
      k.drawRect({ pos: k.vec2(0, 0), width: WIDTH, height: HEIGHT, color: hexColor('#000000'), opacity: 0.55 })
      k.drawText({ text: 'GAME OVER', pos: k.vec2(0, HEIGHT / 2 - 48), size: 30, align: 'center', width: WIDTH, color: hexColor('#f2555a') })
      k.drawText({ text: winner, pos: k.vec2(0, HEIGHT / 2 - 8), size: 20, align: 'center', width: WIDTH, color: hexColor('#f2b84b') })
      k.drawText({ text: 'Refresh for a new room', pos: k.vec2(0, HEIGHT / 2 + 28), size: 14, align: 'center', width: WIDTH, color: hexColor('#7c8394') })
    }
  }

  k.onUpdate(() => {
    pump()
    paintHud()
  })

  k.onDraw(() => {
    drawCourt()
    for (const p of pickups) drawPickup(p)
    for (const b of balls) drawBall(b)
    drawPaddle('host', HOST_COLOR)
    drawPaddle('peer', JOIN_COLOR)
    drawOverlay()
  })

  if (isHost) sendWorld()
}

