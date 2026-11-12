import type { HourInput, PlanResult, SimulationForm } from '../types'
import { HourChart } from './HourChart'
import { HourBreakdown } from './HourBreakdown'
import { UnitTable } from './UnitTable'
import { Summary } from './Summary'
import { fmtInt, yuan } from '../format'

interface Props {
  plan: PlanResult
  other: PlanResult
  form: SimulationForm
  profile: HourInput[]
  planLabel: string
  dayIndex: number
  onDayChange: (index: number) => void
}

export function PlanPanel({
  plan,
  other,
  form,
  profile,
  planLabel,
  dayIndex,
  onDayChange,
}: Props) {
  const safeDay = Math.min(dayIndex, plan.days.length - 1)
  const day = plan.days[safeDay]
  const totalTraffic = profile.reduce((s, h) => s + h.available_impressions, 0)
  const noTraffic = day.hours.every((h) => h.traffic_available === 0)

  return (
    <section className="panel" aria-label={planLabel}>
      <div className="compare-head">
        <h2>{planLabel}</h2>
        <span className="meta">
          权重：{plan.units.map((u) => `${u.unit_id}=${u.weight}`).join(' · ')}
        </span>
      </div>

      <div className="plan-summary">
        <div className="cell">
          <div className="label">多日总支出</div>
          <div className="value">
            ¥{yuan(plan.total_spend_cents)}
          </div>
        </div>
        <div className="cell">
          <div className="label">多日总曝光</div>
          <div className="value">{fmtInt(plan.total_impressions)}</div>
        </div>
        <div className="cell">
          <div className="label">多日总预算</div>
          <div className="value">¥{yuan(plan.total_budget_cents)}</div>
        </div>
        <div className="cell">
          <div className="label">多日未花</div>
          <div className="value">¥{yuan(plan.total_unspent_cents)}</div>
        </div>
      </div>

      <div className="panel-pad" style={{ paddingBottom: 8 }}>
        <div className="day-bar">
          {plan.days.length > 1 && (
            <>
              <span className="label">查看日</span>
              <span className="segmented">
                {plan.days.map((d, i) => (
                  <button
                    key={d.day_index}
                    type="button"
                    aria-pressed={i === safeDay}
                    onClick={() => onDayChange(i)}
                  >
                    第 {i + 1} 天
                  </button>
                ))}
              </span>
            </>
          )}
          <span className="label">
            第 {safeDay + 1} 天 · 当日流量 {fmtInt(totalTraffic)} 次
            {day.carryover_in_cents > 0 &&
              ` · 前日结转 ¥${yuan(day.carryover_in_cents)}`}
          </span>
        </div>

        <Summary plan={plan} day={day} compareAgainst={other} />
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <div>
            <h3 style={{ fontSize: 14 }}>每小时支出（元）</h3>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              单位：元；曲线只连接该单元可投的小时；底色为暂停小时
              {noTraffic && '；本日全天无可用流量，预算全部未花'}
            </p>
          </div>
        </div>
        <HourChart day={day} units={day.units} />
      </div>

      <UnitTable day={day} units={day.units} />
      <HourBreakdown day={day} units={day.units} />

      {form.days > 1 && (
        <p className="diff-note">
          连续回放 {form.days} 天；
          {plan.carryover_enabled
            ? '每天未花余额（含全局未分配）并入次日总预算。'
            : '每天使用原始总预算，未花余额日终清零（默认）。'}
        </p>
      )}
    </section>
  )
}
