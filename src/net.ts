import { joinRoom } from '@trystero-p2p/mqtt'
import type { JoinError, JoinErrorHandler, Room } from '@trystero-p2p/mqtt'
import { APP_ID } from './config'

export function connectRoom(code: string, onJoinError?: JoinErrorHandler): Room {
  return joinRoom(
    { appId: APP_ID },
    code,
    onJoinError ? { onJoinError } : undefined,
  )
}

export function genCode(): string {
  let s = ''
  while (s.length < 6) s += Math.random().toString(36).slice(2)
  return s.slice(0, 6)
}

export function shareLink(code: string): string {
  const url = new URL(location.href)
  url.searchParams.set('room', code)
  return url.toString()
}
