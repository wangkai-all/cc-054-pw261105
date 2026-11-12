import { useId, useMemo, useState } from 'react'
import type { DayResult, UnitDayResult } from '../types'
import { HOUR_LABEL, fmtInt, yuan } from '../format'
import { unitColor } from '../sim'

const PAD_L = 56
const PAD_R = 16
const PAD_T = 14
const PLOT_H = 168
const AXIS_H = 20

interface Props {
  day: DayResult
  units: UnitDayResult[]
}

interface HoverState {
  hour: number
  x: number
  y: number
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const ticks: number[] = [0]
  // 最后一个刻度必须覆盖最大值，否则曲线会画出绘图区。
  for (let v = step; ; v += step) {
    const rounded = Number(v.toFixed(4))
    ticks.push(rounded)
    if (rounded >= max) break
  }
  return ticks
}

function fmtTick(v: number): string {
  if (v === 0) return '0'
  if (v < 1) return v.toFixed(2).replace(/0$/, '')
  return Number.isInteger(v) ? fmtInt(v) : v.toFixed(1)
}

/** 把某单元按小时的花费切成若干段；不可投/暂停小时会断开折线。 */
function segments(unit: UnitDayResult): { hour: number; cents: number }[][] {
  const out: { hour: number; cents: number }[][] = []
  let current: { hour: number; cents: number }[] = []
  for (const h of unit.hours) {
    if (h.status === 'active') {
      current.push({ hour: h.hour, cents: h.spend_cents })
    } else if (current.length) {
      out.push(current)
      current = []
    }
  }
  if (current.length) out.push(current)
  return out
}

/** 把连续的暂停小时合并成一条底色带。 */
function pausedBands(units: UnitDayResult[]): { start: number; end: number }[] {
  const paused = new Set<number>()
  for (const u of units) for (const h of u.hours) if (h.status === 'paused') paused.add(h.hour)
  const bands: { start: number; end: number }[] = []
  for (let h = 0; h < 24; h++) {
    if (!paused.has(h)) continue
    if (bands.length && bands[bands.length - 1].end === h) bands[bands.length - 1].end = h + 1
    else bands.push({ start: h, end: h + 1 })
  }
  return bands
}

export function HourChart({ day, units }: Props) {
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<HoverState | null>(null)

  const W = 1000
  const plotW = W - PAD_L - PAD_R
  const bandW = plotW / 24

  // 纵轴以元为单位，脚注说明；数值本身仍是整数分。
  const maxYuan = Math.max(1, ...units.flatMap((u) => u.hours.map((h) => h.spend_cents / 100)))
  const ticks = niceTicks(maxYuan)
  const yMax = ticks[ticks.length - 1] || 1
  const y = (cents: number) => PAD_T + PLOT_H - (cents / 100 / yMax) * PLOT_H
  const xAt = (hour: number) => PAD_L + bandW * (hour + 0.5)

  const unitSegments = units.map(segments)
  const bands = useMemo(() => pausedBands(units), [units])
  const hoverHour = hover?.hour ?? null
  const hoverRow = hoverHour != null ? day.hours[hoverHour] : null

  return (
    <div>
      <div className="hour-chart">
        <svg
          viewBox={`0 0 ${W} ${PAD_T + PLOT_H + AXIS_H}`}
          role="img"
          aria-label="各投放单元每小时支出曲线；数值可在下方逐小时明细中展开查看"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const px = (e.clientX - rect.left) * (W / rect.width)
            const hour = Math.floor((px - PAD_L) / bandW)
            if (hour < 0 || hour > 23) {
              setHover(null)
              return
            }
            setHover({ hour, x: e.clientX, y: e.clientY })
          }}
        >
          <defs>
            <clipPath id={`clip-${gid}`}>
              <rect x={PAD_L} y={PAD_T} width={plotW} height={PLOT_H} />
            </clipPath>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(t * 100)}
                y2={y(t * 100)}
                stroke={t === 0 ? 'var(--line-strong)' : 'var(--line)'}
                strokeWidth={1}
              />
              <text
                x={PAD_L - 8}
                y={y(t * 100) + 4}
                textAnchor="end"
                fontSize={10}
                fill="var(--text-muted)"
              >
                {fmtTick(t)}
              </text>
            </g>
          ))}


          {/* 暂停小时：合并成整段底色，时段内该单元不投放 */}
          {bands.map((b) => (
            <rect
              key={b.start}
              x={PAD_L + bandW * b.start}
              y={PAD_T}
              width={bandW * (b.end - b.start)}
              height={PLOT_H}
              fill="var(--warning-soft)"
            />
          ))}

          {hoverHour != null && (
            <line
              x1={PAD_L + bandW * (hoverHour + 0.5)}
              x2={PAD_L + bandW * (hoverHour + 0.5)}
              y1={PAD_T}
              y2={PAD_T + PLOT_H}
              stroke="var(--text-muted)"
              strokeWidth={1}
            />
          )}

          <g clipPath={`url(#clip-${gid})`}>
            {units.map((u, ui) => {
              const color = unitColor(u.index)
              const segs = unitSegments[ui]
              const lastSeg = segs[segs.length - 1]
              return (
                <g key={u.unit_id}>
                  {segs.map((seg, si) => (
                    <g key={si}>
                      {seg.length > 1 && (
                        <path
                          d={`M${seg
                            .map((p) => `${xAt(p.hour)},${y(p.cents)}`)
                            .join('L')}`}
                          fill="none"
                          stroke={color}
                          strokeWidth={2}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      )}
                      {seg.length === 1 && (
                        <circle
                          cx={xAt(seg[0].hour)}
                          cy={y(seg[0].cents)}
                          r={2.5}
                          fill={color}
                        />
                      )}
                    </g>
                  ))}
                  {lastSeg && lastSeg.length > 1 && (
                    <circle
                      cx={xAt(lastSeg[lastSeg.length - 1].hour)}
                      cy={y(lastSeg[lastSeg.length - 1].cents)}
                      r={4}
                      fill={color}
                      stroke="var(--surface-1)"
                      strokeWidth={2}
                    />
                  )}
                </g>
              )
            })}
          </g>

          {Array.from({ length: 12 }, (_, i) => i * 2).map((h) => (
            <text
              key={h}
              x={xAt(h)}
              y={PAD_T + PLOT_H + 15}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {String(h).padStart(2, '0')}
            </text>
          ))}
        </svg>
      </div>

      <div className="legend">
        {units.map((u) => (
          <span className="key" key={u.unit_id}>
            <span className="mark" style={{ background: unitColor(u.index) }} />
            {u.unit_id} · {u.name}
          </span>
        ))}
        {bands.length > 0 && (
          <span className="key">
            <span
              className="mark"
              style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning)' }}
            />
            暂停小时（不投放）
          </span>
        )}
      </div>

      {hoverRow && (
        <div
          className="chart-tooltip"
          style={{
            left: hover!.x + 16,
            top: Math.max(8, hover!.y - 12),
            transform:
              hover!.x > window.innerWidth - 260 ? 'translateX(-100%) translateX(-28px)' : undefined,
          }}
        >
          <div className="tt-head">
            <span>{HOUR_LABEL(hoverRow.hour)}</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
              流量 {fmtInt(hoverRow.traffic_available)}
            </span>
          </div>
          {units.map((u) => {
            const h = u.hours.find((row) => row.hour === hoverRow.hour)
            if (!h) return null
            return (
              <div className="tt-row" key={u.unit_id}>
                <span className="key" style={{ background: unitColor(u.index) }} />
                <span className="name">
                  {u.unit_id} · {u.name}
                </span>
                <span className="val">
                  {h.status === 'active'
                    ? `¥${yuan(h.spend_cents)}`
                    : h.status === 'paused'
                      ? '暂停'
                      : '不可投'}
                </span>
              </div>
            )
          })}
          <div className="tt-note">
            本小时总花费 ¥{yuan(hoverRow.spend_cents)} · 剩余流量{' '}
            {fmtInt(hoverRow.traffic_left)}
          </div>
        </div>
      )}
    </div>
  )
}
