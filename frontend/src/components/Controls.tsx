import type { UnitInput, HourInput, SimulationForm, PauseInput } from '../types'
import { MAX_UNITS, unitColor } from '../sim'
import { END_LABEL, HOUR_LABEL, yuan } from '../format'

interface Props {
  form: SimulationForm
  onChange: (next: SimulationForm) => void
  error: string | null
  running: boolean
  samples: { key: string; name: string; description: string }[]
  activeSample: string | null
  onSample: (key: string) => void
  onRun: () => void
  onReset: () => void
}

function yuanToCents(v: string): number {
  // 支持 “400” / “400.50” 这类元输入，统一转整数分。
  if (v.trim() === '') return 0
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

function centsToYuan(cents: number): string {
  return (cents / 100).toString()
}

export function Controls({
  form,
  onChange,
  error,
  running,
  samples,
  activeSample,
  onSample,
  onRun,
  onReset,
}: Props) {
  const set = (patch: Partial<SimulationForm>) => onChange({ ...form, ...patch })

  const setUnit = (i: number, patch: Partial<UnitInput>) => {
    const units = form.units.map((u, j) => (j === i ? { ...u, ...patch } : u))
    set({ units })
  }

  const addUnit = () => {
    if (form.units.length >= MAX_UNITS) return
    const ids = form.units.map((u) => u.unit_id)
    let code = 65
    while (ids.includes(String.fromCharCode(code))) code += 1
    const unit_id = String.fromCharCode(code)
    set({
      units: [
        ...form.units,
        {
          unit_id,
          name: `单元 ${unit_id}`,
          floor_cents: 0,
          weight: 1,
          daily_cap_cents: 20_000,
          active_start_hour: 0,
          active_end_hour: 24,
        },
      ],
    })
  }

  const removeUnit = (i: number) => {
    set({ units: form.units.filter((_, j) => j !== i) })
  }

  const parking = form.pauses[0]
  const setPause = (patch: Partial<PauseInput> | null) => {
    if (!patch) return set({ pauses: [] })
    const base: PauseInput = parking ?? {
      unit_id: form.units[0]?.unit_id ?? 'A',
      requested_hour: 8,
      end_hour: 13,
    }
    set({ pauses: [{ ...base, ...patch }] })
  }

  const totalFloors = form.units.reduce((s, u) => s + u.floor_cents, 0)
  const floorOverBudget = totalFloors > form.base_budget_cents
  const spendable = Math.max(0, form.base_budget_cents - totalFloors)

  return (
    <aside className="panel sticky panel-pad">
      <div className="section-title">
        <h2>投放配置</h2>
        <span className="hint">金额单位：元，按整数分计算</span>
      </div>

      <div className="chip-row" style={{ marginBottom: 14 }}>
        {samples.map((s) => (
          <button
            key={s.key}
            type="button"
            className="chip"
            aria-pressed={activeSample === s.key}
            onClick={() => onSample(s.key)}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="title">方案名称</label>
        <input
          id="title"
          className="input"
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="budget">总预算（元/天）</label>
          <input
            id="budget"
            className="input"
            type="number"
            min={0}
            step={0.01}
            value={centsToYuan(form.base_budget_cents)}
            onChange={(e) => set({ base_budget_cents: yuanToCents(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="days">回放天数</label>
          <input
            id="days"
            className="input"
            type="number"
            min={1}
            max={90}
            value={form.days}
            onChange={(e) => set({ days: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
      </div>

      <div className="alert note" style={{ marginBottom: 12 }}>
        {floorOverBudget ? (
          <span style={{ color: 'var(--critical)' }}>保底合计超出总预算</span>
        ) : (
          <span>保底 ¥{yuan(totalFloors)} · 余 ¥{yuan(spendable)} 按权重分</span>
        )}
      </div>

      <div className="section-title" style={{ marginTop: 4 }}>
        <h2>投放单元</h2>
        <span className="hint">{form.units.length} 个</span>
      </div>

      {form.units.map((u, i) => {
        const paused = form.pauses.some((p) => p.unit_id === u.unit_id)
        return (
          <div className="unit-card" key={u.unit_id}>
            <div className="unit-card-head">
              <span className="swatch" style={{ background: unitColor(i) }} />
              <input
                className="input"
                style={{ width: 54, flex: 'none' }}
                value={u.unit_id}
                aria-label="单元编号"
                onChange={(e) => setUnit(i, { unit_id: e.target.value })}
              />
              <input
                className="input"
                style={{ flex: 1 }}
                value={u.name}
                aria-label="单元名称"
                onChange={(e) => setUnit(i, { name: e.target.value })}
              />
              {form.units.length > 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => removeUnit(i)}
                  aria-label={`删除单元 ${u.unit_id}`}
                >
                  删除
                </button>
              )}
            </div>

            <div className="mini-grid three">
              <div className="field">
                <label>保底（元）</label>
                <input
                  className={`input ${u.floor_cents > u.daily_cap_cents ? 'invalid' : ''}`}
                  type="number"
                  min={0}
                  step={0.01}
                  value={centsToYuan(u.floor_cents)}
                  onChange={(e) => setUnit(i, { floor_cents: yuanToCents(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>每日上限（元）</label>
                <input
                  className={`input ${u.floor_cents > u.daily_cap_cents ? 'invalid' : ''}`}
                  type="number"
                  min={0}
                  step={0.01}
                  value={centsToYuan(u.daily_cap_cents)}
                  onChange={(e) => setUnit(i, { daily_cap_cents: yuanToCents(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>权重（非负）</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={0.1}
                  value={u.weight}
                  onChange={(e) => setUnit(i, { weight: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label>可投时段</label>
              <div className="time-picker full">
                <select
                  className="select"
                  value={u.active_start_hour}
                  aria-label="开始小时"
                  onChange={(e) =>
                    setUnit(i, { active_start_hour: Number(e.target.value) })
                  }
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {HOUR_LABEL(h)}
                    </option>
                  ))}
                </select>
                <span className="sep">–</span>
                <select
                  className="select"
                  value={u.active_end_hour}
                  aria-label="结束小时"
                  onChange={(e) => setUnit(i, { active_end_hour: Number(e.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, k) => k + 1).map((h) => (
                    <option key={h} value={h}>
                      {END_LABEL(h)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="hours-editor" aria-hidden="true">
              {Array.from({ length: 24 }, (_, h) => {
                const active = h >= u.active_start_hour && h < u.active_end_hour
                const isPaused =
                  paused &&
                  active &&
                  form.pauses.some(
                    (p) =>
                      p.unit_id === u.unit_id &&
                      h >= p.requested_hour + 1 &&
                      h < p.end_hour,
                  )
                return (
                  <span
                    key={h}
                    className={isPaused ? 'paused' : active ? 'active' : ''}
                    title={`${HOUR_LABEL(h)} ${isPaused ? '暂停' : active ? '可投' : '不可投'}`}
                  >
                    {isPaused ? '停' : ''}
                  </span>
                )
              })}
            </div>
            {u.floor_cents > u.daily_cap_cents && (
              <div style={{ color: 'var(--critical)', fontSize: 11.5, marginTop: 4 }}>
                保底超过本单元每日上限
              </div>
            )}
          </div>
        )
      })}

      <button
        type="button"
        className="btn"
        style={{ width: '100%' }}
        onClick={addUnit}
        disabled={form.units.length >= MAX_UNITS}
      >
        + 添加投放单元{form.units.length >= MAX_UNITS ? '（最多 8 个）' : ''}
      </button>

      <div className="section-title" style={{ marginTop: 20 }}>
        <h2>暂停</h2>
        <span className="hint">从下一小时生效</span>
      </div>
      <div className="mini-grid">
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>暂停单元</label>
          <select
            className="select"
            value={parking?.unit_id ?? ''}
            onChange={(e) =>
              e.target.value
                ? setPause({ unit_id: e.target.value })
                : setPause(null)
            }
          >
            <option value="">不暂停</option>
            {form.units.map((u) => (
              <option key={u.unit_id} value={u.unit_id}>
                {u.unit_id} · {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>申请小时 → 恢复小时</label>
          <div className="time-picker full">
            <select
              className="select"
              value={parking?.requested_hour ?? 8}
              disabled={!parking}
              aria-label="暂停申请小时"
              onChange={(e) => setPause({ requested_hour: Number(e.target.value) })}
            >
              {Array.from({ length: 23 }, (_, h) => (
                <option key={h} value={h}>
                  {HOUR_LABEL(h)}
                </option>
              ))}
            </select>
            <span className="sep">–</span>
            <select
              className="select"
              value={parking?.end_hour ?? 13}
              disabled={!parking}
              aria-label="暂停恢复小时"
              onChange={(e) => setPause({ end_hour: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, k) => k + 1).map((h) => (
                <option key={h} value={h}>
                  {END_LABEL(h)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>
        <h2>每日结算</h2>
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={form.carryover_enabled}
          onChange={(e) => set({ carryover_enabled: e.target.checked })}
        />
        <span>
          把未花余额结转到次日预算
          <span className="desc" style={{ display: 'block' }}>
            关闭时每天从总预算重新开始（默认）；开启时前一天的单元未花余额与全局未分配金额并入次日总预算。
          </span>
        </span>
      </label>

      {error && (
        <div className="alert error" style={{ marginTop: 12 }} role="alert">
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          type="button"
          className="btn primary"
          style={{ flex: 1 }}
          onClick={onRun}
          disabled={running}
        >
          {running ? '回放中…' : '运行双方案对比'}
        </button>
        <button type="button" className="btn" onClick={onReset} disabled={running}>
          重置
        </button>
      </div>

      <p className="two-col-help" style={{ marginTop: 10 }}>
        两个方案使用完全相同的每小时流量与单价；只有权重不同（等权重 = 所有单元权重 1）。
        {activeSample ? ' 已载入样例：' : ''}
        {samples.find((s) => s.key === activeSample)?.description}
      </p>
    </aside>
  )
}

export type { HourInput }
