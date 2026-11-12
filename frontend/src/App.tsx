import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { cloneForm } from './sim'
import type { PlanResult, SimulationForm, SampleSummary } from './types'
import { Controls } from './components/Controls'
import { ProfileEditor } from './components/ProfileEditor'
import { PlanPanel } from './components/PlanPanel'
import { yuan } from './format'

type Tab = 'flow' | 'compare' | 'rules'

type SampleDetail = SimulationForm & { key: string; name: string; description: string }

/** 样例接口只给流量/单元/暂停；标题、天数、结转等用表单默认值补齐。 */
function formFromSample(detail: SampleDetail): SimulationForm {
  return cloneForm({
    title: detail.title ?? `${detail.name}方案`,
    base_budget_cents: detail.base_budget_cents,
    days: detail.days ?? 1,
    carryover_enabled: detail.carryover_enabled ?? false,
    units: detail.units,
    profile: detail.profile,
    pauses: detail.pauses,
  })
}

const EMPTY_FORM: SimulationForm = {
  title: '未命名方案',
  base_budget_cents: 40_000,
  days: 1,
  carryover_enabled: false,
  units: [],
  profile: Array.from({ length: 24 }, () => ({
    available_impressions: 2_000,
    price_cents: 50,
  })),
  pauses: [],
}

export default function App() {
  const [samples, setSamples] = useState<SampleSummary[]>([])
  const [form, setForm] = useState<SimulationForm>(EMPTY_FORM)
  const [activeSample, setActiveSample] = useState<string | null>(null)
  const [results, setResults] = useState<PlanResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [tab, setTab] = useState<Tab>('compare')
  const [dayIndex, setDayIndex] = useState(0)

  const loadSample = async (key: string) => {
    try {
      const detail = await api.sample(key)
      setForm(formFromSample(detail))
      setActiveSample(key)
      setError(null)
      setResults(null)
      setDayIndex(0)
      setTab('compare')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    api.samples().then(setSamples).catch(() => setSamples([]))
    api
      .sample('uniform')
      .then((detail) => {
        setForm(formFromSample(detail))
        setActiveSample('uniform')
      })
      .catch((err) => setError((err as Error).message))
  }, [])

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      const data = await api.simulate(form)
      setResults(data.results)
      setDayIndex(0)
      setTab('compare')
    } catch (err) {
      setError((err as Error).message)
      setResults(null)
    } finally {
      setRunning(false)
    }
  }

  const equalPlan = results?.[0] ?? null
  const customPlan = results?.[1] ?? null

  const totals = useMemo(() => {
    if (!results) return null
    return {
      equal: results[0].total_spend_cents,
      custom: results[1].total_spend_cents,
    }
  }, [results])

  return (
    <div className="shell">
      <header className="page-header">
        <div>
          <h1>预算分单元 · 逐小时回放</h1>
          <p>
            日预算先满足各单元保底，再按非负权重分剩余；到上限的单元退出后续分配。
            每单元日预算均分到可投小时，按整数次曝光购买，没花完的余款滚到后面的可投小时。
            金额与单价均以整数分处理。
          </p>
        </div>
        <div className="chip-row" aria-label="方案说明">
          <span className="chip">整数分</span>
          <span className="chip">尾差按余数</span>
          <span className="chip">连续回放</span>
          <span className="chip">暂停次小时生效</span>
        </div>
      </header>

      <div className="layout">
        <Controls
          form={form}
          onChange={(next) => {
            setForm(next)
            setActiveSample(null)
          }}
          error={error}
          running={running}
          samples={samples}
          activeSample={activeSample}
          onSample={loadSample}
          onRun={run}
          onReset={() => {
            setResults(null)
            setError(null)
            if (activeSample) loadSample(activeSample)
          }}
        />

        <main style={{ display: 'grid', gap: 20 }}>
          <div className="panel">
            <div className="tabs" role="tablist" aria-label="主视图">
              <button
                className="tab"
                role="tab"
                aria-selected={tab === 'compare'}
                onClick={() => setTab('compare')}
              >
                双方案对比
              </button>
              <button
                className="tab"
                role="tab"
                aria-selected={tab === 'flow'}
                onClick={() => setTab('flow')}
              >
                每小时流量与单价
              </button>
              <button
                className="tab"
                role="tab"
                aria-selected={tab === 'rules'}
                onClick={() => setTab('rules')}
              >
                规则说明
              </button>
            </div>
            <div style={{ padding: '16px 20px 20px' }}>
              {tab === 'flow' && (
                <ProfileEditor profile={form.profile} onChange={(p) => setForm({ ...form, profile: p })} />
              )}
              {tab === 'rules' && <Rules />}
              {tab === 'compare' && <CompareIntro totals={totals} form={form} />}
            </div>
          </div>

          {tab === 'compare' && !results && (
            <div className="panel empty">
              <h2>还没有回放结果</h2>
              <p>
                在左侧选择样例或调整配置，然后运行“双方案对比”。
                两个方案共享同一份流量与单价，只有权重不同。
              </p>
            </div>
          )}

          {tab === 'compare' && results && equalPlan && customPlan && (
            <>
              <PlanPanel
                plan={equalPlan}
                other={customPlan}
                form={form}
                profile={form.profile}
                planLabel="方案一 · 等权重"
                dayIndex={dayIndex}
                onDayChange={setDayIndex}
              />
              <PlanPanel
                plan={customPlan}
                other={equalPlan}
                form={form}
                profile={form.profile}
                planLabel="方案二 · 自定义权重"
                dayIndex={dayIndex}
                onDayChange={setDayIndex}
              />
              <DiffNote equal={equalPlan} custom={customPlan} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function CompareIntro({
  totals,
  form,
}: {
  totals: { equal: number; custom: number } | null
  form: SimulationForm
}) {
  return (
    <div>
      <div className="section-title">
        <h2>相同流量，两种权重</h2>
        <span className="hint">
          总预算 ¥{yuan(form.base_budget_cents)}/天 · {form.days} 天 ·{' '}
          {form.carryover_enabled ? '结转未花余额' : '每日重置'}
        </span>
      </div>
      <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: 820 }}>
        左侧配置同时驱动两个方案：<b>等权重</b>把每个单元的权重视为 1，
        <b>自定义权重</b>使用你填写的权重。保底、上限、可投时段、暂停、每小时流量与单价完全相同，
        因此两边的差异只来自权重分配。
        {totals && (
          <>
            {' '}当前结果总支出：等权重 ¥{yuan(totals.equal)} · 自定义 ¥{yuan(totals.custom)}。
          </>
        )}
      </p>
    </div>
  )
}

function DiffNote({ equal, custom }: { equal: PlanResult; custom: PlanResult }) {
  const rows = equal.units.map((u, i) => {
    const c = custom.units[i]
    return {
      unit: u.unit_id,
      name: u.name,
      equal: equal.days[0].units[i]?.budget_cents ?? 0,
      custom: custom.days[0].units[i]?.budget_cents ?? 0,
      equalSpend: equal.days[0].units[i]?.spend_cents ?? 0,
      customSpend: custom.days[0].units[i]?.spend_cents ?? 0,
      c: c?.weight,
    }
  })
  return (
    <div className="panel panel-pad">
      <div className="section-title">
        <h2>两个方案的分配差异（第 1 天）</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="left">单元</th>
              <th>等权重预算</th>
              <th>自定义预算</th>
              <th>预算差</th>
              <th>等权重支出</th>
              <th>自定义支出</th>
              <th>支出差</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.unit}>
                <td className="left">
                  {r.unit} · {r.name}
                  <span style={{ color: 'var(--text-muted)' }}>（自定义权重 {r.c}）</span>
                </td>
                <td>¥{yuan(r.equal)}</td>
                <td>¥{yuan(r.custom)}</td>
                <td style={{ color: r.custom - r.equal >= 0 ? 'var(--good)' : 'var(--critical)' }}>
                  {r.custom - r.equal >= 0 ? '+' : ''}¥{yuan(r.custom - r.equal)}
                </td>
                <td>¥{yuan(r.equalSpend)}</td>
                <td>¥{yuan(r.customSpend)}</td>
                <td
                  style={{
                    color:
                      r.customSpend - r.equalSpend >= 0 ? 'var(--good)' : 'var(--critical)',
                  }}
                >
                  {r.customSpend - r.equalSpend >= 0 ? '+' : ''}¥
                  {yuan(r.customSpend - r.equalSpend)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legend-note">
        预算差与支出差按自定义方案减等权重方案；流量与单价两边一致，因此支出差来自预算分配与各小时流量约束。
      </p>
    </div>
  )
}

function Rules() {
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 900 }}>
      <div>
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>日预算拆分</h3>
        <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary)' }}>
          <li>先按配置顺序、以整数分满足每个单元的保底金额。</li>
          <li>剩余预算按非负权重比例分配；先取整数地板值，尾差按小数余数从大到小分，余数相同时按固定单元编号升序。</li>
          <li>到每日上限的单元不再参与后续分配，其超出部分退回池中继续分。</li>
          <li>保底超过本单元上限、保底总和超过总预算、单价不大于零、可投时段为空等配置在回放前报错。</li>
          <li>没有正权重单元、或所有单元都触顶时，未分出的余额留在全局未分配金额中。</li>
        </ol>
      </div>
      <div>
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>逐小时回放</h3>
        <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary)' }}>
          <li>每单元日预算均分到可投小时，不足整分的尾差给时间靠前的小时（先得 1 分）。</li>
          <li>当前小时没花完的余款滚到该单元后面的可投小时；不能提前支取后面的预算。</li>
          <li>一次曝光按整数次购买，支出不超过当时可用预算与该小时剩余流量；多个单元共享同一小时的流量，按固定单元编号先买。</li>
          <li>只使用当前小时的数据：未来的流量或价格不会改写过去小时的结果。</li>
          <li>暂停在申请小时的下一小时起生效，直至恢复小时；暂停小时的预算继续向后滚。</li>
        </ol>
      </div>
      <div>
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>多日与结算</h3>
        <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary)' }}>
          <li>可连续回放多天，每天默认从原始总预算重新开始、未花余额日终清零。</li>
          <li>可选“把未花余额结转到次日”：前一天的单元未花余额与全局未分配金额一并加到次日总预算。</li>
          <li>当日未花余额 = 当日预算 − 当日支出（包含未分配到单元的全局未分配金额）。</li>
        </ol>
      </div>
    </div>
  )
}
