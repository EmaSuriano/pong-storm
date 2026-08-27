import { connectRoom, genCode, shareLink } from './net'
import { startGame } from './game'

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error('Required element #' + id + ' is missing')
  return el as T
}

function normalizeCode(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
}

const params = new URLSearchParams(location.search)
const roomParam = params.get('room')

const overlay = required<HTMLElement>('overlay')
const menuMain = required<HTMLElement>('menuMain')
const createPanel = required<HTMLElement>('createPanel')
const joinPanel = required<HTMLElement>('joinPanel')
const createBtn = required<HTMLButtonElement>('createBtn')
const joinMenuBtn = required<HTMLButtonElement>('joinMenuBtn')
const joinBtn = required<HTMLButtonElement>('joinBtn')
const createBack = required<HTMLButtonElement>('createBack')
const joinBack = required<HTMLButtonElement>('joinBack')
const codeDisplay = required<HTMLElement>('codeDisplay')
const linkInput = required<HTMLInputElement>('linkInput')
const joinCode = required<HTMLInputElement>('joinCode')
const copyBtn = required<HTMLButtonElement>('copyBtn')
const statusEl = required<HTMLElement>('status')
const gameWrap = required<HTMLElement>('gameWrap')
const peerCountEl = required<HTMLElement>('peerCount')
const gameCanvas = required<HTMLCanvasElement>('gameCanvas')
const shareBar = required<HTMLElement>('shareBar')
const shareLinkInput = required<HTMLInputElement>('shareLinkInput')
const shareCopyBtn = required<HTMLButtonElement>('shareCopyBtn')

function showError(msg: string) {
  overlay.style.display = 'flex'
  gameWrap.style.display = 'none'
  statusEl.classList.add('err')
  statusEl.textContent = msg
}

function showMain() {
  menuMain.classList.remove('hide')
  createPanel.classList.remove('show')
  joinPanel.classList.remove('show')
  statusEl.classList.remove('err')
  statusEl.textContent = ''
}

function showJoin() {
  menuMain.classList.add('hide')
  createPanel.classList.remove('show')
  joinPanel.classList.add('show')
  joinCode.focus()
}

function go(code: string, isHost: boolean) {
  const room = connectRoom(code, (details) => {
    showError(details.error)
  })
  overlay.style.display = 'none'
  gameWrap.style.display = 'flex'
  const link = shareLink(code)
  shareLinkInput.value = link
  if (isHost) shareBar.classList.add('show')
  else shareBar.classList.remove('show')
  startGame(room, { isHost, canvas: gameCanvas, peerCountEl, roomCode: code, shareBar })
}

function copyShare(btn: HTMLButtonElement, value: string) {
  shareLinkInput.select()
  void navigator.clipboard.writeText(value)
  const prev = btn.textContent
  btn.textContent = 'Copied!'
  setTimeout(() => {
    btn.textContent = prev
  }, 1200)
}

copyBtn.addEventListener('click', () => {
  copyShare(copyBtn, linkInput.value)
})

shareCopyBtn.addEventListener('click', () => {
  copyShare(shareCopyBtn, shareLinkInput.value)
})

function onCreate() {
  try {
    const code = genCode()
    const link = shareLink(code)
    codeDisplay.textContent = code.toUpperCase()
    linkInput.value = link
    statusEl.classList.remove('err')
    statusEl.textContent = ''
    go(code, true)
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err))
  }
}

function onJoin() {
  const code = normalizeCode(joinCode.value)
  if (code.length < 4) {
    statusEl.classList.add('err')
    statusEl.textContent = 'Enter the 6-character room code from the host.'
    return
  }
  try {
    const link = shareLink(code)
    statusEl.classList.remove('err')
    statusEl.textContent = 'Joining ' + code + '...'
    go(code, false)
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err))
  }
}
function boot() {
  createBtn.onclick = onCreate
  joinMenuBtn.onclick = showJoin
  joinBtn.onclick = onJoin
  joinBack.onclick = showMain
  createBack.onclick = showMain
  joinCode.onkeydown = onJoinKey
  if (roomParam) {
    joinCode.value = roomParam
    go(roomParam, false)
  }
}

function onJoinKey(e: KeyboardEvent) {
  if (e.key === 'Enter') onJoin()
}

const FILE_OPEN_HINT = 'Use the Vite dev server, not a file URL.'

try {
  if (location.protocol === 'file:') {
    createBtn.disabled = true
    joinBtn.disabled = true
    showError(FILE_OPEN_HINT)
  } else {
    boot()
  }
} catch (err) {
  showError(err instanceof Error ? err.message : String(err))
}
