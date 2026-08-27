import kaplay from 'kaplay'
import type { Room } from '@trystero-p2p/mqtt'
import {
  WIDTH,
  HEIGHT,
  GRID,
  SPEED,
  HOST_COLOR,
  JOIN_COLOR,
} from './config'

type HelloMsg = { color: string }
type PosMsg = { x: number; y: number }

export function startGame(
  room: Room,
  opts: { isHost: boolean; canvas: HTMLCanvasElement; peerCountEl: HTMLElement },
): void {
  const { isHost, canvas, peerCountEl } = opts

  const k = kaplay({
    global: false,
    width: WIDTH,
    height: HEIGHT,
    letterbox: true,
    background: [16, 19, 26],
    crisp: true,
    canvas,
  })

  const helloAction = room.makeAction<HelloMsg>('hello')
  const posAction = room.makeAction<PosMsg>('pos')

  const myColor = isHost ? HOST_COLOR : JOIN_COLOR
  const peerColorDefault = isHost ? JOIN_COLOR : HOST_COLOR
  const myX = isHost ? 260 : 360
  const peerX = isHost ? 360 : 260

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

  function makePlayer(x: number, y: number, color: string) {
    const p = k.add([
      k.pos(x, y),
      k.rect(GRID, GRID),
      k.color(hexColor(color)),
      k.outline(2, hexColor('#0d1016')),
      k.area(),
      k.z(1),
    ])
    return p
  }

  for (let i = 0; i < 60; i++) {
    k.add([
      k.pos(k.rand(0, WIDTH), k.rand(0, HEIGHT)),
      k.rect(4, 4),
      k.color(hexColor(i % 2 === 0 ? '#1e2430' : '#232a38')),
      k.z(0),
    ])
  }

  const me = makePlayer(myX, 190, myColor)
  const peers = new Map<string, ReturnType<typeof makePlayer>>()

  function ensurePeer(peerId: string, color?: string) {
    if (!peers.has(peerId)) {
      peers.set(peerId, makePlayer(peerX, 190, color || peerColorDefault))
    }
    return peers.get(peerId)!
  }

  function refreshPeerCount() {
    peerCountEl.textContent = String(peers.size)
  }

  function greetPeer(peerId: string) {
    ensurePeer(peerId)
    refreshPeerCount()
    helloAction.send({ color: myColor }, { target: peerId })
    posAction.send({ x: me.pos.x, y: me.pos.y }, { target: peerId })
  }

  room.onPeerJoin = (peerId) => {
    greetPeer(peerId)
  }

  room.onPeerLeave = (peerId) => {
    const sprite = peers.get(peerId)
    if (sprite) sprite.destroy()
    peers.delete(peerId)
    refreshPeerCount()
  }

  helloAction.onMessage = (data, context) => {
    ensurePeer(context.peerId, data && data.color)
    refreshPeerCount()
  }

  posAction.onMessage = (data, context) => {
    const sprite = ensurePeer(context.peerId)
    if (data) {
      sprite.pos.x = data.x
      sprite.pos.y = data.y
    }
  }

  if (typeof room.getPeers === 'function') {
    const existing = room.getPeers() || {}
    const ids = Array.isArray(existing) ? existing : Object.keys(existing)
    for (const peerId of ids) greetPeer(peerId)
  }

  let lastSent = 0
  k.onUpdate(() => {
    let dx = 0
    let dy = 0
    if (k.isKeyDown('left') || k.isKeyDown('a')) dx -= 1
    if (k.isKeyDown('right') || k.isKeyDown('d')) dx += 1
    if (k.isKeyDown('up') || k.isKeyDown('w')) dy -= 1
    if (k.isKeyDown('down') || k.isKeyDown('s')) dy += 1

    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1
      me.pos.x += (dx / len) * SPEED * k.dt()
      me.pos.y += (dy / len) * SPEED * k.dt()
      me.pos.x = k.clamp(me.pos.x, 0, WIDTH - GRID)
      me.pos.y = k.clamp(me.pos.y, 0, HEIGHT - GRID)
    }

    const now = performance.now()
    if (now - lastSent > 50) {
      lastSent = now
      posAction.send({ x: me.pos.x, y: me.pos.y })
    }
  })
}
