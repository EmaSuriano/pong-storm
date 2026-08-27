import kaplay from 'kaplay'
import type { Room } from '@trystero-p2p/mqtt'
import {
  WIDTH,
  HEIGHT,
  HOST_COLOR,
  JOIN_COLOR,
  WIN_SCORE,
  MAX_BALLS,
  MULTIBALL_SCORE,
  PADDLE_W,
  PADDLE_H,
  PADDLE_SPEED,
  PADDLE_MARGIN,
  GIANT_SCALE,
  GIANT_TIME,
  BALL_R,
  BALL_SPEED,
  BALL_SPEED_MAX,
  SMASH_SPEED,
  SMASH_CHARGE_TIME,
  SWING_WINDOW,
  ENGLISH,
  ANGLE_KICK,
  CURVE_SPIN,
  SERVE_DELAY,
  PICKUP_R,
  PICKUP_EVERY,
  MAX_PICKUPS,
  NET_HZ,
  POWERS,
  POWER_LABEL,
  POWER_COLOR,
  BALL_COLORS,
  type PowerKind,
} from './config'

type Side = 'left' | 'right'
type MatchStatus = 'wait' | 'play' | 'over' | 'left'

type InputMsg = {
  y: number
  charge: number
  smashHeld: boolean
  swing: boolean
}

type BallSnap = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  spin: number
  ghost: boolean
  hot: number
  tint: number
}

type PickupSnap = {
  id: number
  x: number
  y: number
  kind: PowerKind
}

type WorldMsg = {
  balls: BallSnap[]
  pickups: PickupSnap[]
  leftY: number
  rightY: number
  leftH: number
  rightH: number
  leftCharge: number
  rightCharge: number
  leftScore: number
  rightScore: number
  leftPower: PowerKind | null
  rightPower: PowerKind | null
  status: MatchStatus
  winner: Side | null
  serveT: number
  fx: number
  shake: number
  flash: number
  flashSide: Side | null
}

type Ball = BallSnap & {
  lastHit: Side | null
  hitCd: number
}

type Paddle = {
  side: Side
  x: number
  y: number
  h: number
  vy: number
  charge: number
  smashHeld: boolean
  swing: number
  power: PowerKind | null
  giantT: number
}

type Pickup = PickupSnap

const NET_DT = 1 / NET_HZ
const LEFT_X = PADDLE_MARGIN
const RIGHT_X = WIDTH - PADDLE_MARGIN

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

export function startGame(
  room: Room,
  opts: { isHost: boolean; canvas: HTMLCanvasElement; peerCountEl: HTMLElement; roomCode: string; shareBar?: HTMLElement },
): void {
  const { isHost, canvas, peerCountEl, roomCode, shareBar } = opts
  const endBar = document.getElementById('endBar')
  const rematchBtn = document.getElementById('rematchBtn') as HTMLButtonElement | null
  const endNote = document.getElementById('endNote')
  const mySide: Side = isHost ? 'left' : 'right'

  const k = kaplay({
    global: false,
    width: WIDTH,
    height: HEIGHT,
    letterbox: true,
    background: [112, 128, 160],
    crisp: false,
    canvas,
  })

  const assetBase = import.meta.env.BASE_URL
  let artOk = false
  k.loadSprite('courtBg', `${assetBase}court-bg.png`).onLoad(() => { artOk = true })
  k.loadSprite('paddleHost', `${assetBase}paddle-host.png`)
  k.loadSprite('paddleJoin', `${assetBase}paddle-join.png`)
  k.loadSprite('ballArt', `${assetBase}ball.png`)
  for (const kind of POWERS) {
    k.loadSprite('pickup-' + kind, `${assetBase}pickup-${kind}.png`)
  }

  function spriteReady(name: string): boolean {
    const a = k.getSprite(name)
    return !!(a && a.loaded && a.data)
  }

  const preventKeys = (ev: KeyboardEvent) => {
    if (
      ev.code === 'Space' ||
      ev.code === 'ArrowUp' ||
      ev.code === 'ArrowDown' ||
      ev.key === ' '
    ) {
      ev.preventDefault()
    }
  }
  window.addEventListener('keydown', preventKeys, { passive: false })

  const inputAction = room.makeAction<InputMsg>('inp')
  const worldAction = room.makeAction<WorldMsg>('wld')
  const rematchAction = room.makeAction<{ v: number }>('rmt')

  function rgbHex(hex: string) {
    const n = hex.replace('#', '')
    const r = parseInt(n.slice(0, 2), 16) || 0
    const g = parseInt(n.slice(2, 4), 16) || 0
    const b = parseInt(n.slice(4, 6), 16) || 0
    return k.rgb(r, g, b)
  }

  const hostCol = rgbHex(HOST_COLOR)
  const joinCol = rgbHex(JOIN_COLOR)
  const ink = rgbHex('#FCF1E1')
  const dim = rgbHex('#8090A0')
  const table = rgbHex('#7080A0')
  const lineCol = rgbHex('#A090C0')
  const danger = rgbHex('#F58463')
  const cream = rgbHex('#FCF1E1')

  function makePaddle(side: Side): Paddle {
    return {
      side,
      x: side === 'left' ? LEFT_X : RIGHT_X,
      y: HEIGHT / 2,
      h: PADDLE_H,
      vy: 0,
      charge: 0,
      smashHeld: false,
      swing: 0,
      power: null,
      giantT: 0,
    }
  }

  const left = makePaddle('left')
  const right = makePaddle('right')
  const paddles: Record<Side, Paddle> = { left, right }

  let balls: Ball[] = []
  let pickups: Pickup[] = []
  let leftScore = 0
  let rightScore = 0
  let status: MatchStatus = 'wait'
  let winner: Side | null = null
  let serveT = 0
  let serveDir = 1
  let pickupT = PICKUP_EVERY * 0.4
  let nextBallId = 1
  let nextPickupId = 1
  let multiDone = false
  let fxSeq = 0
  let lastFx = 0
  let shakeSend = 0
  let flashT = 0
  let flashSide: Side | null = null
  let clock = 0
  let opponentId: string | null = null
  const seenPeers = new Set<string>()
  let swingLatch = false
  let wasSmash = false
  let netAcc = 0

  function paddleOf(side: Side): Paddle {
    return paddles[side]
  }

  function targetHeight(p: Paddle): number {
    return p.giantT > 0 ? PADDLE_H * GIANT_SCALE : PADDLE_H
  }

  function clampPaddle(p: Paddle): void {
    const hh = p.h / 2
    p.y = clamp(p.y, hh + 4, HEIGHT - hh - 4)
  }

  function launchBall(dir: number): void {
    if (balls.length >= MAX_BALLS) return
    const ang = randRange(-0.42, 0.42)
    const speed = BALL_SPEED
    balls.push({
      id: nextBallId++,
      x: WIDTH / 2,
      y: HEIGHT / 2,
      vx: Math.cos(ang) * speed * dir,
      vy: Math.sin(ang) * speed,
      spin: 0,
      ghost: false,
      hot: 0,
      tint: (nextBallId - 2) % BALL_COLORS.length,
      lastHit: null,
      hitCd: 0,
    })
  }

  function queueServe(dir?: number): void {
    serveT = SERVE_DELAY
    serveDir = dir ?? (Math.random() < 0.5 ? -1 : 1)
  }

  function setShareBar(on: boolean): void {
    if (!shareBar) return
    if (on && isHost) shareBar.classList.add('show')
    else shareBar.classList.remove('show')
  }

  function beginMatch(): void {
    if (status === 'play' || status === 'over') return
    status = 'play'
    leftScore = 0
    rightScore = 0
    balls = []
    pickups = []
    multiDone = false
    winner = null
    left.power = null
    right.power = null
    left.giantT = 0
    right.giantT = 0
    queueServe()
    setShareBar(false)
    setEndBar(false)
  }

  function setEndBar(on: boolean, note = ''): void {
    if (!endBar) return
    if (on) endBar.classList.add('show')
    else endBar.classList.remove('show')
    if (endNote) endNote.textContent = note
    if (rematchBtn) {
      const can = on && !!opponentId && status !== 'left'
      rematchBtn.disabled = !can
      rematchBtn.textContent = opponentId ? 'Play again' : 'Opponent left'
    }
  }

  function resetMatch(): void {
    leftScore = 0
    rightScore = 0
    balls = []
    pickups = []
    multiDone = false
    winner = null
    left.power = null
    right.power = null
    left.giantT = 0
    right.giantT = 0
    left.charge = 0
    right.charge = 0
    left.swing = 0
    right.swing = 0
    left.h = PADDLE_H
    right.h = PADDLE_H
    status = 'play'
    setShareBar(false)
    setEndBar(false)
    queueServe()
  }

  function boom(n: number): void {
    fxSeq += 1
    shakeSend = n
    if (typeof k.shake === 'function') k.shake(n)
  }

  function givePower(side: Side, kind: PowerKind): void {
    const p = paddleOf(side)
    if (kind === 'giant') {
      p.giantT = GIANT_TIME
      return
    }
    p.power = kind
  }

  function consume(p: Paddle, kind: PowerKind): boolean {
    if (p.power !== kind) return false
    p.power = null
    return true
  }

  function applySpin(b: BallSnap, dt: number): void {
    if (!b.spin) return
    const speed = Math.hypot(b.vx, b.vy)
    if (speed < 1) return
    const ang = Math.atan2(b.vy, b.vx) + b.spin * dt
    b.vx = Math.cos(ang) * speed
    b.vy = Math.sin(ang) * speed
  }

  function bounceWalls(b: BallSnap): void {
    if (b.y < BALL_R) {
      b.y = BALL_R
      b.vy = Math.abs(b.vy)
    } else if (b.y > HEIGHT - BALL_R) {
      b.y = HEIGHT - BALL_R
      b.vy = -Math.abs(b.vy)
    }
  }

  function hitsPaddle(b: Ball, p: Paddle): boolean {
    const hx = PADDLE_W / 2
    const hy = p.h / 2
    const closestX = clamp(b.x, p.x - hx, p.x + hx)
    const closestY = clamp(b.y, p.y - hy, p.y + hy)
    const dx = b.x - closestX
    const dy = b.y - closestY
    return dx * dx + dy * dy <= (BALL_R + 1) * (BALL_R + 1)
  }

  function bouncePaddle(b: Ball, p: Paddle): void {
    const dir = p.side === 'left' ? 1 : -1
    const opponent: Side = p.side === 'left' ? 'right' : 'left'
    if (b.ghost && b.lastHit === opponent) {
      b.ghost = false
      b.hitCd = 0.05
      return
    }

    const rel = clamp((b.y - p.y) / (p.h / 2 || 1), -1, 1)
    let speed = Math.hypot(b.vx, b.vy)
    const smashPower = p.power === 'smash'
    const charged = p.charge > 0.12 && (p.smashHeld || p.swing > 0)
    const doSmash = smashPower || charged
    if (doSmash) {
      const t = smashPower ? 1 : clamp(p.charge, 0.35, 1)
      speed = BALL_SPEED * 0.55 + SMASH_SPEED * (0.45 + 0.55 * t)
      b.hot = 0.35
      boom(10 + 18 * t)
      if (smashPower) consume(p, 'smash')
      p.charge = 0
      p.swing = 0
    } else {
      speed = clamp(speed * 1.045, BALL_SPEED, BALL_SPEED_MAX)
    }

    const maxAng = 0.9 * ANGLE_KICK
    const ang = rel * maxAng
    b.vx = Math.cos(ang) * speed * dir
    b.vy = Math.sin(ang) * speed + p.vy * ENGLISH
    const s2 = Math.hypot(b.vx, b.vy) || 1
    b.vx = (b.vx / s2) * speed
    b.vy = (b.vy / s2) * speed
    b.x = p.x + dir * (PADDLE_W / 2 + BALL_R + 2)
    b.lastHit = p.side
    b.hitCd = 0.08
    b.spin = 0

    if (consume(p, 'curve')) {
      const sign = rel !== 0 ? Math.sign(rel) : Math.sign(p.vy) || dir
      b.spin = sign * CURVE_SPIN
    }
    if (consume(p, 'ghost')) b.ghost = true
    if (p.power === 'split') {
      consume(p, 'split')
      splitBall(b)
    }
  }

  function splitBall(src: Ball): void {
    if (balls.length >= MAX_BALLS) return
    const speed = Math.hypot(src.vx, src.vy)
    const ang = Math.atan2(src.vy, src.vx)
    const clone: Ball = {
      id: nextBallId++,
      x: src.x,
      y: src.y,
      vx: Math.cos(ang + 0.32) * speed,
      vy: Math.sin(ang + 0.32) * speed,
      spin: src.spin,
      ghost: false,
      hot: src.hot * 0.6,
      tint: (src.tint + 1) % BALL_COLORS.length,
      lastHit: src.lastHit,
      hitCd: 0.08,
    }
    src.vx = Math.cos(ang - 0.2) * speed
    src.vy = Math.sin(ang - 0.2) * speed
    balls.push(clone)
  }

  function maybeMultiball(): void {
    if (multiDone) return
    if (leftScore >= MULTIBALL_SCORE && rightScore >= MULTIBALL_SCORE) {
      multiDone = true
      if (balls.length < MAX_BALLS) launchBall(Math.random() < 0.5 ? -1 : 1)
    }
  }

  function scoreFor(side: Side): void {
    if (status !== 'play') return
    if (side === 'left') leftScore += 1
    else rightScore += 1
    flashT = 0.4
    flashSide = side
    if (leftScore >= WIN_SCORE) {
      status = 'over'
      winner = 'left'
      setEndBar(true)
    } else if (rightScore >= WIN_SCORE) {
      status = 'over'
      winner = 'right'
      setEndBar(true)
    }
    maybeMultiball()
  }

  function stepSim(dt: number): void {
    const sides: Side[] = ['left', 'right']
    for (const side of sides) {
      const p = paddleOf(side)
      if (p.giantT > 0) p.giantT = Math.max(0, p.giantT - dt)
      p.h += (targetHeight(p) - p.h) * Math.min(1, 12 * dt)
      p.swing = Math.max(0, p.swing - dt)
      clampPaddle(p)
    }

    if (status !== 'play') return

    if (serveT > 0) {
      serveT -= dt
      if (serveT <= 0) {
        serveT = 0
        launchBall(serveDir)
      }
    }

    pickupT -= dt
    if (pickupT <= 0) {
      pickupT = PICKUP_EVERY + randRange(-1.2, 1.8)
      if (pickups.length < MAX_PICKUPS) {
        pickups.push({
          id: nextPickupId++,
          x: WIDTH * 0.5 + randRange(-WIDTH * 0.22, WIDTH * 0.22),
          y: randRange(56, HEIGHT - 56),
          kind: pick(POWERS),
        })
      }
    }

    for (const b of balls) {
      b.hitCd = Math.max(0, b.hitCd - dt)
      b.hot = Math.max(0, b.hot - dt)
      applySpin(b, dt)
      b.x += b.vx * dt
      b.y += b.vy * dt
      bounceWalls(b)

      if (b.hitCd <= 0) {
        if (b.vx < 0 && hitsPaddle(b, left)) bouncePaddle(b, left)
        else if (b.vx > 0 && hitsPaddle(b, right)) bouncePaddle(b, right)
      }

      for (let i = pickups.length - 1; i >= 0; i--) {
        const pk = pickups[i]!
        const dx = b.x - pk.x
        const dy = b.y - pk.y
        if (dx * dx + dy * dy <= (BALL_R + PICKUP_R) * (BALL_R + PICKUP_R)) {
          if (b.lastHit) givePower(b.lastHit, pk.kind)
          pickups.splice(i, 1)
        }
      }
    }

    const remaining: Ball[] = []
    for (const b of balls) {
      if (b.x < -BALL_R) {
        scoreFor('right')
        continue
      }
      if (b.x > WIDTH + BALL_R) {
        scoreFor('left')
        continue
      }
      remaining.push(b)
    }
    balls = remaining

    if (status === 'play' && balls.length === 0 && serveT <= 0) queueServe()
  }

  function readLocalInput(dt: number): void {
    const p = paddleOf(mySide)
    const up = k.isKeyDown('up') || k.isKeyDown('w')
    const down = k.isKeyDown('down') || k.isKeyDown('s')
    const prevY = p.y
    let dy = 0
    if (up) dy -= 1
    if (down) dy += 1
    p.y += dy * PADDLE_SPEED * dt
    clampPaddle(p)
    p.vy = dt > 0 ? (p.y - prevY) / dt : 0

    const smashDown = k.isKeyDown('space') || k.isKeyDown('j')
    p.smashHeld = smashDown
    if (smashDown) p.charge = clamp(p.charge + dt / SMASH_CHARGE_TIME, 0, 1)
    else if (p.swing <= 0) p.charge = clamp(p.charge - dt * 1.8, 0, 1)
    if (wasSmash && !smashDown) {
      swingLatch = true
      p.swing = SWING_WINDOW
    }
    wasSmash = smashDown
  }

  function snapshot(): WorldMsg {
    return {
      balls: balls.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        spin: b.spin,
        ghost: b.ghost,
        hot: b.hot,
        tint: b.tint,
      })),
      pickups: pickups.map((p) => ({ id: p.id, x: p.x, y: p.y, kind: p.kind })),
      leftY: left.y,
      rightY: right.y,
      leftH: left.h,
      rightH: right.h,
      leftCharge: left.charge,
      rightCharge: right.charge,
      leftScore,
      rightScore,
      leftPower: left.power,
      rightPower: right.power,
      status,
      winner,
      serveT,
      fx: fxSeq,
      shake: shakeSend,
      flash: flashT,
      flashSide,
    }
  }

  function applyWorld(msg: WorldMsg): void {
    if (msg.fx !== lastFx) {
      lastFx = msg.fx
      if (msg.shake > 0 && typeof k.shake === 'function') k.shake(msg.shake)
    }
    leftScore = msg.leftScore
    rightScore = msg.rightScore
    status = msg.status
    winner = msg.winner
    serveT = msg.serveT
    flashT = msg.flash
    flashSide = msg.flashSide
    pickups = msg.pickups.map((p) => ({ ...p }))
    left.power = msg.leftPower
    right.power = msg.rightPower
    left.charge = msg.leftCharge
    left.y += (msg.leftY - left.y) * 0.55
    left.h = msg.leftH
    right.h += (msg.rightH - right.h) * 0.4

    const seen = new Set<number>()
    for (const s of msg.balls) {
      seen.add(s.id)
      const cur = balls.find((b) => b.id === s.id)
      if (!cur) {
        balls.push({ ...s, lastHit: null, hitCd: 0 })
        continue
      }
      const dx = s.x - cur.x
      const dy = s.y - cur.y
      if (dx * dx + dy * dy > 72 * 72) {
        cur.x = s.x
        cur.y = s.y
      } else {
        cur.x += dx * 0.5
        cur.y += dy * 0.5
      }
      cur.vx = s.vx
      cur.vy = s.vy
      cur.spin = s.spin
      cur.ghost = s.ghost
      cur.hot = s.hot
      cur.tint = s.tint
    }
    balls = balls.filter((b) => seen.has(b.id))
  }

  function deadReckon(dt: number): void {
    for (const b of balls) {
      b.hot = Math.max(0, b.hot - dt)
      applySpin(b, dt)
      b.x += b.vx * dt
      b.y += b.vy * dt
      bounceWalls(b)
    }
  }

  function refreshPeerCount(n: number): void {
    peerCountEl.textContent = String(n)
  }

  function greetPeer(peerId: string): void {
    seenPeers.add(peerId)
    if (!opponentId) opponentId = peerId
    refreshPeerCount(opponentId ? 1 : 0)
    if (isHost) beginMatch()
  }

  room.onPeerJoin = (peerId) => {
    greetPeer(peerId)
  }

  room.onPeerLeave = (peerId) => {
    seenPeers.delete(peerId)
    if (opponentId === peerId || !isHost) {
      opponentId = null
      refreshPeerCount(0)
      if (isHost) {
        status = 'wait'
        balls = []
        pickups = []
        setShareBar(true)
        setEndBar(false)
      } else {
        status = 'left'
        setEndBar(true, 'Host left')
      }
    }
  }

  function applyHostInput(data: InputMsg, peerId?: string): void {
    if (!isHost || !data) return
    if (peerId) {
      if (opponentId && peerId !== opponentId) return
      if (!opponentId) opponentId = peerId
    }
    const prevY = right.y
    right.y = clamp(data.y, 0, HEIGHT)
    right.vy = (right.y - prevY) * NET_HZ
    right.charge = data.charge
    right.smashHeld = data.smashHeld
    if (data.swing) right.swing = SWING_WINDOW
    clampPaddle(right)
    if (status === 'wait') beginMatch()
  }

  inputAction.onMessage = (data, context) => {
    applyHostInput(data, context.peerId)
  }

  worldAction.onMessage = (data) => {
    if (isHost || !data) return
    applyWorld(data)
    if (data.status === 'over') setEndBar(true)
    else if (data.status === 'play') setEndBar(false)
    else if (data.status === 'left') setEndBar(true, 'Host left')
  }

  function requestRematch(): void {
    if (status !== 'over') return
    if (!opponentId) {
      setEndBar(true, 'Opponent left')
      return
    }
    if (isHost) resetMatch()
    else {
      rematchAction.send({ v: 1 })
      bcSend({ t: 'rmt' })
    }
  }

  rematchAction.onMessage = (_data, context) => {
    if (!isHost) return
    if (opponentId && context.peerId !== opponentId) return
    if (status !== 'over' || !opponentId) return
    resetMatch()
  }

  rematchBtn?.addEventListener('click', () => {
    requestRematch()
  })

  type BcMsg =
    | { t: 'here'; role: 'host' | 'peer' }
    | { t: 'world'; world: WorldMsg }
    | { t: 'inp'; data: InputMsg }
    | { t: 'rmt' }

  let bc: BroadcastChannel | null = null
  try {
    bc = new BroadcastChannel('pong-storm:' + roomCode)
  } catch {
    bc = null
  }

  function bcSend(msg: BcMsg): void {
    try {
      bc?.postMessage(msg)
    } catch {
      /* ignore closed channel */
    }
  }

  function shoutHere(): void {
    bcSend({ t: 'here', role: isHost ? 'host' : 'peer' })
  }

  function pollPeers(): void {
    if (typeof room.getPeers !== 'function') return
    const existing = room.getPeers() || {}
    const ids = Array.isArray(existing) ? existing : Object.keys(existing)
    for (const peerId of ids) {
      if (!seenPeers.has(peerId)) greetPeer(peerId)
    }
  }

  pollPeers()

  if (bc) {
    bc.onmessage = (ev: MessageEvent<BcMsg>) => {
      const msg = ev.data
      if (!msg || typeof msg !== 'object') return
      if (msg.t === 'here') {
        if (isHost && msg.role === 'peer') beginMatch()
        return
      }
      if (msg.t === 'world' && !isHost) {
        applyWorld(msg.world)
        if (msg.world.status === 'over') setEndBar(true)
        else if (msg.world.status === 'play') setEndBar(false)
        return
      }
      if (msg.t === 'inp' && isHost) {
        applyHostInput(msg.data)
        return
      }
      if (msg.t === 'rmt' && isHost && status === 'over' && opponentId) {
        resetMatch()
      }
    }
  }

  shoutHere()
  window.setInterval(() => {
    if (status === 'wait') shoutHere()
  }, 250)

  function sendNet(): void {
    if (isHost) {
      const snap = snapshot()
      worldAction.send(snap)
      bcSend({ t: 'world', world: snap })
      shakeSend = 0
    } else {
      const p = paddleOf(mySide)
      const swing = swingLatch
      swingLatch = false
      const data: InputMsg = {
        y: p.y,
        charge: p.charge,
        smashHeld: p.smashHeld,
        swing,
      }
      inputAction.send(data)
      bcSend({ t: 'inp', data })
    }
  }

  function drawGlowCircle(
    x: number,
    y: number,
    r: number,
    color: ReturnType<typeof rgbHex>,
    extra = 1,
    opacity = 1,
  ): void {
    k.drawCircle({
      pos: k.vec2(x, y),
      radius: r * 3.1 * extra,
      color,
      opacity: 0.1 * opacity,
    })
    k.drawCircle({
      pos: k.vec2(x, y),
      radius: r * 1.75 * extra,
      color,
      opacity: 0.28 * opacity,
    })
    k.drawCircle({
      pos: k.vec2(x, y),
      radius: r,
      color,
      opacity,
    })
  }

  function drawPaddleGfx(p: Paddle, color: ReturnType<typeof rgbHex>): void {
    const glow = 0.25 + p.charge * 0.7
    const spriteName = p.side === 'left' ? 'paddleHost' : 'paddleJoin'
    const pw = PADDLE_W * 1.35
    const opacity = 0.92 + p.charge * 0.08
    if (spriteReady(spriteName)) {
      k.drawSprite({
        sprite: spriteName,
        pos: k.vec2(p.x, p.y),
        width: pw,
        height: p.h,
        anchor: 'center',
        opacity,
      })
    } else {
      k.drawRect({
        pos: k.vec2(p.x, p.y),
        width: PADDLE_W,
        height: p.h,
        color,
        opacity: 0.85 + p.charge * 0.15,
        anchor: 'center',
      })
    }
    if (p.charge > 0.02) {
      const h = p.h * p.charge
      k.drawRect({
        pos: k.vec2(
          p.x + (p.side === 'left' ? -PADDLE_W : PADDLE_W),
          p.y + (p.h / 2 - h / 2),
        ),
        width: 4,
        height: h,
        color: cream,
        opacity: glow,
        anchor: 'center',
      })
    }
  }

  function drawHud(): void {
    k.drawText({
      text: String(leftScore),
      pos: k.vec2(WIDTH / 2 - 72, 28),
      size: 42,
      color: hostCol,
      anchor: 'center',
    })
    k.drawText({
      text: String(rightScore),
      pos: k.vec2(WIDTH / 2 + 72, 28),
      size: 42,
      color: joinCol,
      anchor: 'center',
    })

    const lp = left.power ? POWER_LABEL[left.power] : '—'
    const rp = right.power ? POWER_LABEL[right.power] : '—'
    k.drawText({
      text: lp,
      pos: k.vec2(WIDTH / 2 - 72, 58),
      size: 12,
      color: left.power ? rgbHex(POWER_COLOR[left.power]) : dim,
      anchor: 'center',
    })
    k.drawText({
      text: rp,
      pos: k.vec2(WIDTH / 2 + 72, 58),
      size: 12,
      color: right.power ? rgbHex(POWER_COLOR[right.power]) : dim,
      anchor: 'center',
    })
  }

  let lastSim = performance.now()
  function pump(): void {
    pollPeers()
    const now = performance.now()
    const dt = Math.min((now - lastSim) / 1000, 0.05)
    if (dt < 1 / 60) return
    lastSim = now
    clock += dt
    flashT = Math.max(0, flashT - dt)
    readLocalInput(dt)

    if (isHost) {
      if (swingLatch) {
        left.swing = SWING_WINDOW
        swingLatch = false
      }
      stepSim(dt)
    } else {
      deadReckon(dt)
      clampPaddle(right)
    }

    netAcc += dt
    if (netAcc >= NET_DT) {
      netAcc = 0
      sendNet()
    }
  }
  window.setInterval(pump, 50)
  k.onUpdate(() => {
    pump()
  })
  window.addEventListener('visibilitychange', () => {
    shoutHere()
    pump()
    if (isHost) sendNet()
  })

  k.onDraw(() => {
    if (artOk && spriteReady('courtBg')) {
      k.drawSprite({
        sprite: 'courtBg',
        pos: k.vec2(0, 0),
        width: WIDTH,
        height: HEIGHT,
      })
    } else {
      k.drawRect({
        pos: k.vec2(0, 0),
        width: WIDTH,
        height: HEIGHT,
        color: table,
      })
    }

    k.drawRect({
      pos: k.vec2(4, 4),
      width: WIDTH - 8,
      height: HEIGHT - 8,
      color: lineCol,
      fill: false,
      outline: { width: 1, color: lineCol },
      opacity: 0.16,
    })

    for (let y = 18; y < HEIGHT - 18; y += 22) {
      k.drawRect({
        pos: k.vec2(WIDTH / 2, y),
        width: 3,
        height: 10,
        color: cream,
        anchor: 'center',
        opacity: 0.25,
      })
    }

    if (flashT > 0 && flashSide) {
      k.drawRect({
        pos: k.vec2(flashSide === 'left' ? 0 : WIDTH / 2, 0),
        width: WIDTH / 2,
        height: HEIGHT,
        color: flashSide === 'left' ? joinCol : hostCol,
        opacity: flashT * 0.12,
      })
    }

    for (const pk of pickups) {
      const col = rgbHex(POWER_COLOR[pk.kind])
      const pulse = 1 + 0.08 * Math.sin(clock * 6 + pk.id)
      const sz = PICKUP_R * 2.4 * pulse
      const spr = 'pickup-' + pk.kind
      if (spriteReady(spr)) {
        k.drawSprite({
          sprite: spr,
          pos: k.vec2(pk.x, pk.y),
          width: sz,
          height: sz,
          anchor: 'center',
        })
      } else {
        drawGlowCircle(pk.x, pk.y, PICKUP_R * pulse, col, 1.1)
      }
      k.drawText({
        text: POWER_LABEL[pk.kind][0]!,
        pos: k.vec2(pk.x, pk.y),
        size: 14,
        color: rgbHex('#4A3F4A'),
        anchor: 'center',
      })
    }

    if (serveT > 0 && status === 'play') {
      const a = 0.35 + 0.25 * Math.sin(clock * 8)
      drawGlowCircle(WIDTH / 2, HEIGHT / 2, BALL_R, ink, 1.4, a)
    }

    for (const b of balls) {
      const peach = rgbHex('#F0B090')
      const op = b.ghost ? 0.45 : 1
      const hotScale = b.hot > 0 ? 1.12 : 1
      const size = BALL_R * 2 * hotScale
      if (b.hot > 0) {
        k.drawCircle({
          pos: k.vec2(b.x - Math.sign(b.vx) * 8, b.y),
          radius: BALL_R * 1.15,
          color: peach,
          opacity: 0.28 * Math.min(1, b.hot * 3),
        })
      }
      if (spriteReady('ballArt')) {
        k.drawSprite({
          sprite: 'ballArt',
          pos: k.vec2(b.x, b.y),
          width: size,
          height: size,
          anchor: 'center',
          opacity: op,
        })
      } else {
        const hex = BALL_COLORS[b.tint % BALL_COLORS.length] || BALL_COLORS[0]!
        k.drawCircle({
          pos: k.vec2(b.x, b.y),
          radius: BALL_R * hotScale,
          color: rgbHex(hex),
          opacity: op,
        })
      }
    }

    drawPaddleGfx(left, hostCol)
    drawPaddleGfx(right, joinCol)
    drawHud()

    if (status === 'wait') {
      k.drawRect({
        pos: k.vec2(0, 0),
        width: WIDTH,
        height: HEIGHT,
        color: rgbHex('#4A3F5A'),
        opacity: 0.38,
      })
      k.drawText({
        text: 'PONGSTORM',
        pos: k.vec2(WIDTH / 2, HEIGHT / 2 - 28),
        size: 36,
        color: cream,
        anchor: 'center',
      })
      k.drawText({
        text: isHost ? 'INVITE BELOW  ·  WAITING FOR CHALLENGER' : 'CONNECTING TO HOST',
        pos: k.vec2(WIDTH / 2, HEIGHT / 2 + 16),
        size: 14,
        color: dim,
        anchor: 'center',
      })
    } else if (status === 'left') {
      k.drawText({
        text: 'HOST LEFT',
        pos: k.vec2(WIDTH / 2, HEIGHT / 2 - 10),
        size: 32,
        color: danger,
        anchor: 'center',
      })
      k.drawText({
        text: 'MATCH OVER',
        pos: k.vec2(WIDTH / 2, HEIGHT / 2 + 24),
        size: 16,
        color: dim,
        anchor: 'center',
      })
    } else if (status === 'over') {
      k.drawRect({
        pos: k.vec2(0, 0),
        width: WIDTH,
        height: HEIGHT,
        color: rgbHex('#4A3F5A'),
        opacity: 0.4,
      })
      const label = winner === 'left' ? 'HOST WINS' : 'JOINER WINS'
      k.drawText({
        text: label,
        pos: k.vec2(WIDTH / 2, HEIGHT / 2 - 8),
        size: 34,
        color: winner === 'left' ? hostCol : joinCol,
        anchor: 'center',
      })
      k.drawText({
        text: `${leftScore}  —  ${rightScore}`,
        pos: k.vec2(WIDTH / 2, HEIGHT / 2 + 28),
        size: 18,
        color: ink,
        anchor: 'center',
      })
    }
  })
}
