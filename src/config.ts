export const APP_ID = 'pong-storm'

export const WIDTH = 800
export const HEIGHT = 480

export const HOST_COLOR = '#6ee7a8'
export const JOIN_COLOR = '#f2b84b'

export const WIN_SCORE = 7
export const MAX_BALLS = 6
export const MULTIBALL_SCORE = 2

export const PADDLE_W = 14
export const PADDLE_H = 90
export const PADDLE_SPEED = 420
export const PADDLE_MARGIN = 36
export const GIANT_SCALE = 1.72
export const GIANT_TIME = 5.5

export const BALL_R = 8
export const BALL_SPEED = 310
export const BALL_SPEED_MAX = 740
export const SMASH_SPEED = 660
export const SMASH_CHARGE_TIME = 0.65
export const SWING_WINDOW = 0.24
export const ENGLISH = 0.42
export const ANGLE_KICK = 0.95
export const CURVE_SPIN = 2.35
export const SERVE_DELAY = 0.9

export const PICKUP_R = 15
export const PICKUP_EVERY = 6.5
export const MAX_PICKUPS = 2

export const NET_HZ = 20

export const POWERS = ['split', 'smash', 'giant', 'curve', 'ghost'] as const
export type PowerKind = (typeof POWERS)[number]

export const POWER_LABEL: Record<PowerKind, string> = {
  split: 'SPLIT',
  smash: 'SMASH',
  giant: 'GIANT',
  curve: 'CURVE',
  ghost: 'GHOST',
}

export const POWER_COLOR: Record<PowerKind, string> = {
  split: '#7dd3fc',
  smash: '#fb7185',
  giant: '#86efac',
  curve: '#c4b5fd',
  ghost: '#e5e7eb',
}

export const BALL_COLORS = [
  '#f8fafc',
  '#7dd3fc',
  '#f0abfc',
  '#fde047',
  '#fb7185',
  '#86efac',
]
