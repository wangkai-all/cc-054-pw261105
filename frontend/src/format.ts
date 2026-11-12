export function yuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function fmtInt(n: number): string {
  return n.toLocaleString('zh-CN')
}

export function pct(part: number, whole: number, digits = 1): string {
  if (whole <= 0) return '—'
  return `${((part / whole) * 100).toFixed(digits)}%`
}

export const HOUR_LABEL = (h: number) => `${String(h).padStart(2, '0')}:00`

/** 结束小时可以是 24，表示次日 00:00。 */
export const END_LABEL = (h: number) => (h === 24 ? '24:00' : HOUR_LABEL(h))

export function hourRange(start: number, end: number): string {
  return `${HOUR_LABEL(start)}–${HOUR_LABEL(end % 24 === 0 ? 0 : end)}`
}

export const STATUS_LABEL: Record<string, string> = {
  active: '投放',
  paused: '暂停',
  inactive: '不可投',
}
