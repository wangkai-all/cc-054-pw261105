import type { DayResult, UnitDayResult } from '../types'
import { END_LABEL, HOUR_LABEL, fmtInt, pct, yuan } from '../format'
import { unitColor } from '../sim'

interface Props {
  day: DayResult
  units: UnitDayResult[]
}

export function UnitTable({ day, units }: Props) {
  // 预算与支出共用同一条基线，长度可直接比较。
  const maxValue = Math.max(
    1,
    ...units.flatMap((u) => [u.budget_cents, u.spend_cents]),
  )
  const allocated = units.reduce((s, u) => s + u.budget_cents, 0)

  return (
    <div className="panel">
      <div className="section-title panel-pad" style={{ paddingBottom: 4 }}>
        <h2>投放单元分配</h2>
        <span className="hint">
          拆出的 {yuan(allocated)} 元 / 当日 {yuan(day.budget_cents)} 元
          {day.unallocated_cents > 0 && ` · 全局未分配 ¥${yuan(day.unallocated_cents)}`}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="left">单元</th>
              <th>保底</th>
              <th>按权重</th>
              <th>日预算</th>
              <th>上限</th>
              <th className="bar-cell">支出 / 日预算</th>
              <th>支出</th>
              <th>曝光</th>
              <th>未花</th>
              <th className="left">可投时段</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const color = unitColor(u.index)
              return (
                <tr key={u.unit_id}>
                  <td className="left">
                    <span className="unit-name">
                      <span className="swatch" style={{ background: color }} />
                      {u.unit_id}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                        {u.name}
                      </span>
                      {u.capped && (
                        <span className="tag warn" title="达到每日上限，不再参与后续分配">
                          已触顶
                        </span>
                      )}
                    </span>
                  </td>
                  <td>{yuan(u.floor_cents)}</td>
                  <td>¥{yuan(u.weight_awarded_cents)}</td>
                  <td>
                    <b>¥{yuan(u.budget_cents)}</b>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>¥{yuan(u.daily_cap_cents)}</td>
                  <td className="bar-cell">
                    <div
                      className="spend-bar"
                      title={`已支出 ¥${yuan(u.spend_cents)} · 日预算 ¥${yuan(u.budget_cents)}`}
                      aria-hidden="true"
                    >
                      <span
                        style={{
                          width: `${(u.spend_cents / maxValue) * 100}%`,
                          background: color,
                        }}
                      />
                      <span className="spacer" />
                      <span
                        className="budget-ghost"
                        style={{
                          width: `${Math.max(
                            0,
                            ((u.budget_cents - u.spend_cents) / maxValue) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                  </td>
                  <td>¥{yuan(u.spend_cents)}</td>
                  <td>{fmtInt(u.purchased_impressions)}</td>
                  <td>
                    ¥{yuan(u.unspent_cents)}
                    {u.budget_cents > 0 && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        {' '}
                        · {pct(u.spend_cents, u.budget_cents)} 花掉
                      </span>
                    )}
                  </td>
                  <td className="left" style={{ color: 'var(--text-secondary)' }}>
                    {HOUR_LABEL(u.active_start_hour)}–{END_LABEL(u.active_end_hour)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="legend-note" style={{ padding: '0 20px 14px' }}>
        <span>彩色 = 已支出，灰色 = 分到但没花完的预算；各单元同一比例尺</span>
        {day.unallocated_cents > 0 && (
          <span>
            全局未分配 ¥{yuan(day.unallocated_cents)}（无正权重或全部触顶，留作未分配金额）
          </span>
        )}
      </div>
    </div>
  )
}
