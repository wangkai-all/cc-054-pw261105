import type { DayResult, PlanResult } from '../types'
import { fmtInt, pct, yuan } from '../format'

interface Props {
  plan: PlanResult
  day: DayResult
  compareAgainst?: PlanResult
}

export function Summary({ plan, day, compareAgainst }: Props) {
  const units = day.units
  const allocated = units.reduce((s, u) => s + u.budget_cents, 0)
  const spent = day.spend_cents
  const unspent = day.unspent_cents

  let headNote: string | null = null
  if (compareAgainst) {
    const other = compareAgainst.days[day.day_index]
    if (other) {
      const delta = spent - other.spend_cents
      const di = day.purchased_impressions - other.purchased_impressions
      headNote =
        `较另一方案（同日）：支出 ${delta >= 0 ? '多' : '少'} ¥${yuan(Math.abs(delta))}，` +
        `曝光 ${di >= 0 ? '多' : '少'} ${fmtInt(Math.abs(di))} 次`
    }
  }

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">当日预算</div>
          <div className="value">
            ¥{yuan(day.budget_cents)}
            {day.carryover_in_cents > 0 && (
              <small>含结转 ¥{yuan(day.carryover_in_cents)}</small>
            )}
          </div>
          <div className="sub">总预算 ¥{yuan(day.base_budget_cents)}</div>
        </div>
        <div className="kpi">
          <div className="label">已分配</div>
          <div className="value">¥{yuan(allocated)}</div>
          <div className="sub">
            {pct(allocated, day.budget_cents)} · 未分配 ¥{yuan(day.unallocated_cents)}
          </div>
        </div>
        <div className="kpi">
          <div className="label">已支出</div>
          <div className="value">¥{yuan(spent)}</div>
          <div className="sub">
            花掉 {pct(spent, day.budget_cents)} · {fmtInt(day.purchased_impressions)} 次曝光
          </div>
        </div>
        <div className="kpi">
          <div className="label">未花余额</div>
          <div className="value">¥{yuan(unspent)}</div>
          <div className="sub">
            {plan.carryover_enabled ? '结转到次日预算' : '日终清零'}
          </div>
        </div>
      </div>
      {headNote && <p className="legend-note" style={{ marginTop: 10 }}>{headNote}</p>}
    </div>
  )
}
