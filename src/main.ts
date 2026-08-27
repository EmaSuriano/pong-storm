import { connectRoom, genCode, shareLink } from './net'
import { startGame } from './game'

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Required element #${id} is missing`)
  return el as T
}

const params = new URLSearchParams(location.search)
const roomParam = params.get('room')
const isHost = !roomParam
let roomCode = roomParam

const overlay = required<HTMLElement>('overlay')
const hostBtn = required<HTMLButtonElement>('hostBtn')
const linkRow = required<HTMLElement>('linkRow')
const linkInput = required<HTMLInputElement>('linkInput')
const copyBtn = required<HTMLButtonElement>('copyBtn')
const statusEl = required<HTMLElement>('status')
const gameWrap = required<HTMLElement>('gameWrap')
const peerCountEl = required<HTMLElement>('peerCount')
const gameCanvas = required<HTMLCanvasElement>('gameCanvas')

function showError(msg: string) {
  overlay.style.display = 'flex'
  gameWrap.style.display = 'none'
  statusEl.classList.add('err')
  statusEl.textContent = msg
}

function go(code: string) {
  const room = connectRoom(code, (details) => {
    showError(details.error)
  })
  overlay.style.display = 'none'
  gameWrap.style.display = 'flex'
  startGame(room, { isHost, canvas: gameCanvas, peerCountEl })
}

copyBtn.addEventListener('click', () => {
  linkInput.select()
  void navigator.clipboard.writeText(linkInput.value)
  copyBtn.textContent = 'Copied!'
  setTimeout(() => {
    copyBtn.textContent = 'Copy'
  }, 1200)
})

function onHostClick() {
  try {
    roomCode = genCode()
    const link = shareLink(roomCode)
    linkInput.value = link
    linkRow.classList.add('show')
    history.replaceState(null, '', link)
    statusEl.classList.remove('err')
    statusEl.textContent = 'Room created. Waiting for a friend to join...'
    hostBtn.disabled = true
    hostBtn.textContent = 'Room open'
    go(roomCode)
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err))
  }
}

const FILE_OPEN_HINT = "Open this with npm run dev (http://localhost:3000), not as a file."

function boot() {
  if (!roomParam) {
    hostBtn.addEventListener('click', onHostClick)
    return
  }
  hostBtn.style.display = 'none'
  statusEl.textContent = 'Joining room "' + roomParam + '"...'
  go(roomParam)
}

try {
  if (location.protocol === 'file:') {
    hostBtn.disabled = true
    showError(FILE_OPEN_HINT)
  } else {
    boot()
  }
} catch (err) {
  showError(err instanceof Error ? err.message : String(err))
}
