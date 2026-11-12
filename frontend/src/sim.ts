import type { DayResult, HourInput, PlanResult, SimulationForm, UnitHourResult, UnitInput } from './types'

// 固定顺序的 8 槽分类色板（浅色/深色由 CSS 变量按主题切换）。
export const MAX_UNITS = 8
export const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const

export function unitColor(index: number): string {
  return SERIES[Math.min(index, SERIES.length - 1)]
}

export function cloneForm(form: SimulationForm): SimulationForm {
  return JSON.parse(JSON.stringify(form))
}

export function blankUnit(index: number): UnitInput {
  return {
    unit_id: String.fromCharCode(65 + index),
    name: `单元 ${String.fromCharCode(65 + index)}`,
    floor_cents: 0,
    weight: 1,
    daily_cap_cents: 20_000,
    active_start_hour: 0,
    active_end_hour: 24,
  }
}

export function dayOf(plan: PlanResult, dayIndex: number): DayResult {
  return plan.days[Math.min(dayIndex, plan.days.length - 1)]
}

export function hourOf(unit: { hours: UnitHourResult[] }, hour: number): UnitHourResult | undefined {
  return unit.hours.find((h) => h.hour === hour)
}

export function trafficTotal(profile: HourInput[]): number {
  return profile.reduce((sum, h) => sum + h.available_impressions, 0)
}

/** 只把有变化的小时写回表单，便于粘贴导入后保持整洁。 */
export function summarizeProfile(profile: HourInput[]): string {
  return profile
    .map((h, i) => `${i}\t${h.available_impressions}\t${h.price_cents}`)
    .join('\n')
}
