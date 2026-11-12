import { useState } from 'react'
import type { DayResult, UnitDayResult } from '../types'
import { HOUR_LABEL, STATUS_LABEL, fmtInt, yuan } from '../format'
import { unitColor } from '../sim'

interface Props {
  day: DayResult
  units: UnitDayResult[]
}

export function HourBreakdown({ day, units }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  const carry = day.carryover_in_cents

  return (
    <div className="panel">
      <div className="section-title panel-pad" style={{ paddingBottom: 0 }}>
        <h2>逐小时明细</h2>
        <span className="hint">
          点击小时展开：预算从哪来、买了多少曝光、余款滚到哪里
        </span>
      </div>

      {Array.from({ length: 24 }, (_, hour) => {
        const row = day.hours[hour]
        const expanded = open === hour
        return (
          <div key={hour}>
            <button
              type="button"
              className="expander"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : hour)}
            >
              <span className="chev">▶</span>
              <span className="h">{HOUR_LABEL(hour)}</span>
              <span className="traffic">
                流量 {fmtInt(row.traffic_available)} · 单价 ¥{yuan(row.price_cents)}
                {hour === 0 && carry > 0 && (
                  <span className="tag good" style={{ marginLeft: 8 }}>
                    前日结转 ¥{yuan(carry)}
                  </span>
                )}
                {row.units.some((u) => u.status === 'paused') && (
                  <span className="tag warn" style={{ marginLeft: 8 }}>
                    含暂停单元
                  </span>
                )}
              </span>
              <span className="sum">
                <span>
                  曝光 <b>{fmtInt(row.purchased_impressions)}</b>
                </span>
                <span>
                  花费 <b>¥{yuan(row.spend_cents)}</b>
                </span>
                <span>
                  流量余 <b>{fmtInt(row.traffic_left)}</b>
                </span>
              </span>
            </button>

            {expanded && (
              <div className="hour-detail">
                <div className="hour-db-grid">
                  {units.map((u) => {
                    const h = u.hours.find((x) => x.hour === hour)
                    if (!h) return null
                    const color = unitColor(u.index)
                    return (
                      <div className="hour-db" key={u.unit_id}>
                        <div className="head">
                          <span className="label">
                            <span
                              style={{
                                display: 'inline-block',
                                width: 8,
                                height: 8,
                                borderRadius: 2,
                                background: color,
                              }}
                            />
                            {u.unit_id} · {u.name}
                          </span>
                          <span className={`status ${h.status}`}>
                            {STATUS_LABEL[h.status]}
                          </span>
                        </div>
                        <dl>
                          <dt>小时切片</dt>
                          <dd>¥{yuan(h.slice_cents)}</dd>
                          <dt>上小时滚入</dt>
                          <dd>¥{yuan(h.rolled_in_cents)}</dd>
                          <dt>本小时可花</dt>
                          <dd>
                            <b>¥{yuan(h.available_cents)}</b>
                          </dd>
                          <dt>流量 / 单价</dt>
                          <dd>
                            {fmtInt(h.traffic_available)} · ¥{yuan(h.price_cents)}
                          </dd>
                          <dt>购买曝光</dt>
                          <dd>{fmtInt(h.purchased_impressions)} 次</dd>
                          <dt>本小时支出</dt>
                          <dd>¥{yuan(h.spend_cents)}</dd>
                        </dl>
                        <div className="flow">
                          {h.status === 'active' ? (
                            <>
                              <span>
                                切片 <code>¥{yuan(h.slice_cents)}</code> + 滚入{' '}
                                <code>¥{yuan(h.rolled_in_cents)}</code> = 可花{' '}
                                <code>¥{yuan(h.available_cents)}</code>
                              </span>
                              <span>
                                按 <code>¥{yuan(h.price_cents)}</code>/次买{' '}
                                <code>{fmtInt(h.purchased_impressions)}</code> 次，花{' '}
                                <code>¥{yuan(h.spend_cents)}</code>
                                {h.traffic_available <= 0
                                  ? '（无可用流量）'
                                  : h.available_cents - h.spend_cents < h.price_cents
                                    ? '（余额不足再买一次）'
                                    : '（流量已买完）'}
                              </span>
                              <span>
                                余款 <code>¥{yuan(h.rolled_out_cents)}</code> 滚到下一可投小时
                              </span>
                            </>
                          ) : (
                            <>
                              <span>
                                切片 <code>¥{yuan(h.slice_cents)}</code> + 滚入{' '}
                                <code>¥{yuan(h.rolled_in_cents)}</code>
                              </span>
                              <span>
                                {h.status === 'paused'
                                  ? '暂停中，不购买'
                                  : '不在可投时段，不购买'}
                                ；全额 <code>¥{yuan(h.rolled_out_cents)}</code> 继续向后滚
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
