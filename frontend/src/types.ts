export interface UnitInput {
  unit_id: string
  name: string
  floor_cents: number
  weight: number
  daily_cap_cents: number
  active_start_hour: number
  active_end_hour: number
}

export interface HourInput {
  available_impressions: number
  price_cents: number
}

export interface PauseInput {
  unit_id: string
  requested_hour: number
  end_hour: number
  effective_start_hour?: number
}

export interface UnitHourResult {
  hour: number
  status: 'active' | 'paused' | 'inactive'
  slice_cents: number
  rolled_in_cents: number
  available_cents: number
  purchased_impressions: number
  spend_cents: number
  rolled_out_cents: number
  traffic_available: number
  traffic_left_after: number
  price_cents: number
}

export interface UnitDayResult {
  unit_id: string
  name: string
  index: number
  budget_cents: number
  floor_cents: number
  floor_awarded_cents: number
  weight_awarded_cents: number
  weight: number
  daily_cap_cents: number
  active_start_hour: number
  active_end_hour: number
  capped: boolean
  spend_cents: number
  purchased_impressions: number
  unspent_cents: number
  hours: UnitHourResult[]
}

export interface HourUnitSlice {
  unit_id: string
  index: number
  status: 'active' | 'paused' | 'inactive'
  slice_cents: number
  rolled_in_cents: number
  available_cents: number
  purchased_impressions: number
  spend_cents: number
  rolled_out_cents: number
  price_cents: number
  traffic_left_after: number
}

export interface HourRow {
  hour: number
  traffic_available: number
  price_cents: number
  traffic_left: number
  spend_cents: number
  purchased_impressions: number
  units: HourUnitSlice[]
}

export interface DayResult {
  day_index: number
  base_budget_cents: number
  carryover_in_cents: number
  budget_cents: number
  unallocated_cents: number
  floor_total_cents: number
  spend_cents: number
  purchased_impressions: number
  unspent_cents: number
  units: UnitDayResult[]
  hours: HourRow[]
}

export interface PlanResult {
  plan_id: 'equal' | 'custom'
  title: string
  carryover_enabled: boolean
  units: UnitInput[]
  days: DayResult[]
  total_budget_cents: number
  total_spend_cents: number
  total_impressions: number
  total_unspent_cents: number
}

export interface SimulationForm {
  title: string
  base_budget_cents: number
  days: number
  carryover_enabled: boolean
  units: UnitInput[]
  profile: HourInput[]
  pauses: PauseInput[]
}

export interface SampleSummary {
  key: string
  name: string
  description: string
}
