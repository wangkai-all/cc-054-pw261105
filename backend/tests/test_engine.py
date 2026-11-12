from fractions import Fraction

import pytest

from app.engine import (
    ConfigError,
    HourData,
    PauseWindow,
    UnitInput,
    allocate_by_weight,
    plan_day,
    simulate_plan,
    split_across_hours,
)


def u(uid, floor=0, weight=1, cap=10_000, start=0, end=24, name=""):
    return UnitInput(uid, name or uid, floor, Fraction(str(weight)), cap, start, end)


def test_floors_then_weights():
    units = [u("A", floor=1000, weight=1, cap=10_000), u("B", floor=2000, weight=3, cap=10_000)]
    plan = plan_day(units, 10_000)
    a, b = plan.units
    assert a.floor_awarded_cents == 1000
    assert b.floor_awarded_cents == 2000
    # 余 7,000 按 1:3 => 1,750 / 5,250
    assert a.budget_cents == 2_750
    assert b.budget_cents == 7_250
    assert plan.unallocated_cents == 0


def test_fraction_remainder_by_remainder_then_unit_id():
    units = [u("A", weight=1, cap=10_000), u("B", weight=1, cap=10_000), u("C", weight=1, cap=10_000)]
    plan = plan_day(units, 10)
    # 10/3 = 3.333 余 0.333 各相同，余 1 分按编号升序给 A
    assert [p.budget_cents for p in plan.units] == [4, 3, 3]


def test_remainder_tie_uses_unit_id_not_config_order():
    # B 先配置，但平局按固定单元编号排序，A 先得尾差。
    units = [u("B", weight=1, cap=100), u("A", weight=1, cap=100)]
    plan = plan_day(units, 3)
    by_id = {p.unit_id: p.budget_cents for p in plan.units}
    assert by_id == {"A": 2, "B": 1}


def test_remainder_ordered_by_fractional_part():
    units = [u("A", weight=3, cap=100), u("B", weight=1, cap=100)]
    plan = plan_day(units, 9)
    # 9 * 3/4 = 6.75, 9 * 1/4 = 2.25; floors 6/2, 余 1 分给余数大的 A
    assert [p.budget_cents for p in plan.units] == [7, 2]


def test_zero_weight_units_get_floor_only():
    units = [u("A", floor=500, weight=0), u("B", weight=1)]
    plan = plan_day(units, 5_000)
    assert plan.units[0].budget_cents == 500
    assert plan.units[1].budget_cents == 4_500


def test_cap_exits_remaining_distribution():
    units = [u("A", weight=5, cap=2_000), u("B", weight=1, cap=10_000)]
    plan = plan_day(units, 10_000)
    a, b = plan.units
    assert a.budget_cents == 2_000
    assert a.capped
    assert b.budget_cents == 8_000
    assert plan.unallocated_cents == 0


def test_all_capped_leaves_unallocated():
    units = [u("A", weight=1, cap=100), u("B", weight=1, cap=100)]
    plan = plan_day(units, 1_000)
    assert plan.unallocated_cents == 800


def test_no_positive_weight_leaves_unallocated():
    units = [u("A", weight=0, cap=10_000), u("B", weight=0, cap=10_000)]
    plan = plan_day(units, 1_000)
    assert [p.budget_cents for p in plan.units] == [0, 0]
    assert plan.unallocated_cents == 1_000


def test_floor_over_cap_errors():
    with pytest.raises(ConfigError, match="超过本单元"):
        plan_day([u("A", floor=5_000, cap=1_000)], 10_000)


def test_floor_sum_over_budget_errors():
    with pytest.raises(ConfigError, match="保底金额总和"):
        plan_day([u("A", floor=600), u("B", floor=600)], 1_000)


def test_hour_split_puts_extra_on_earliest_hours():
    assert split_across_hours(100, 0, 3) == {0: 34, 1: 33, 2: 33}
    assert split_across_hours(10, 22, 24) == {22: 5, 23: 5}


def test_split_zero_budget():
    assert split_across_hours(0, 0, 2) == {}


PROFILE = [HourData(1_000, 50) for _ in range(24)]


def test_simulation_buys_integer_impressions_within_budget_and_traffic():
    res = simulate_plan(
        "p", "t", [u("A", floor=1000, cap=10_000)], 5_000, 1, PROFILE, [], False
    )
    day = res.days[0]
    hour = day.units[0].hours[0]
    assert hour.price_cents == 50
    assert hour.spend_cents == hour.purchased_impressions * 50
    assert hour.available_cents // 50 >= hour.purchased_impressions
    assert res.total_spend_cents + res.total_unspent_cents == 5_000


def test_unspent_rolls_to_next_hour():
    units = [u("A", cap=100_000)]
    profile = [HourData(100, 50) for _ in range(24)]  # 每小时最多花 5,000 分
    res = simulate_plan("p", "t", units, 20_000, 1, profile, [], False)
    ur = res.days[0].units[0]
    # 日预算 20,000 均分到 24 小时：833 分，尾差 8 分给最靠前的 8 个小时，
    # 所以首小时分到 834 分；按 50 分/次最多买 16 次（800 分），余 34 分。
    assert ur.hours[0].slice_cents == 834
    assert ur.hours[0].spend_cents == 800
    assert ur.hours[0].rolled_out_cents == 34
    assert ur.hours[1].rolled_in_cents == 34


def test_shared_hour_traffic_bought_in_unit_id_order():
    # B 先配置，但同一小时的流量按固定单元编号先买：A 抢到唯一一次曝光。
    units = [u("B", cap=100_000), u("A", cap=100_000)]
    profile = [HourData(1, 100) for _ in range(24)]  # 每小时只有 1 次曝光
    res = simulate_plan("p", "t", units, 20_000, 1, profile, [], False)
    day = res.days[0]
    a = next(x for x in day.units if x.unit_id == "A")
    b = next(x for x in day.units if x.unit_id == "B")
    assert a.hours[0].purchased_impressions == 1
    assert b.hours[0].purchased_impressions == 0
    assert b.hours[1].rolled_in_cents > 0
    assert [s["unit_id"] for s in day.hours[0].units] == ["A", "B"]


def test_pause_takes_effect_next_hour_and_rolls_budget_forward():
    profile = [HourData(0, 50) for _ in range(24)]
    profile[13] = HourData(10_000, 50)
    res = simulate_plan(
        "p", "t", [u("A", cap=10_000)], 1_000, 1, profile,
        [PauseWindow("A", 8, 13)], False,
    )
    hours = res.days[0].units[0].hours
    assert hours[8].status == "active"  # 8 点申请，8 点仍投放
    assert hours[9].status == "paused"
    assert hours[12].status == "paused"
    assert hours[13].status == "active"
    # 8 点流量为 0，预算不花
    assert hours[8].spend_cents == 0
    assert hours[9].rolled_in_cents == hours[8].rolled_out_cents
    # 13 点恢复，流量足够，花掉全部（有逐步滚入的余额）
    assert hours[13].spend_cents > 0


def test_future_traffic_never_changes_past():
    profile = [HourData(0, 50) for _ in range(24)]
    profile[20] = HourData(10_000, 50)
    early = simulate_plan("p", "t", [u("A")], 10_000, 1, profile, [], False)
    late = simulate_plan(
        "p", "t", [u("A")], 10_000, 1,
        [HourData(0, 50)] * 20 + [HourData(10_000, 50)] + [HourData(0, 50)] * 3,
        [], False,
    )
    assert early.days[0].units[0].hours[5].spend_cents == 0
    assert late.days[0].units[0].hours[5].spend_cents == 0


def test_multi_day_carryover_off_resets():
    profile = [HourData(0, 50) for _ in range(24)]
    res = simulate_plan("p", "t", [u("A", cap=10_000)], 1_000, 3, profile, [], False)
    assert [d.budget_cents for d in res.days] == [1_000, 1_000, 1_000]
    assert [d.unspent_cents for d in res.days] == [1_000, 1_000, 1_000]


def test_multi_day_carryover_on_adds_unspent():
    profile = [HourData(0, 50) for _ in range(24)]
    res = simulate_plan("p", "t", [u("A", cap=10_000)], 1_000, 3, profile, [], True)
    assert res.days[0].carryover_in_cents == 0
    assert res.days[1].budget_cents == 2_000
    assert res.days[1].carryover_in_cents == 1_000
    assert res.days[2].budget_cents == 3_000


def test_day_budget_includes_global_unallocated_in_unspent():
    profile = [HourData(0, 50) for _ in range(24)]
    res = simulate_plan(
        "p", "t", [u("A", weight=0, cap=100)], 5_000, 1, profile, [], False
    )
    day = res.days[0]
    assert day.unallocated_cents == 5_000
    assert day.spend_cents == 0
    assert day.unspent_cents == 5_000


def test_pause_must_span_at_least_one_effective_hour():
    with pytest.raises(ConfigError, match="恢复小时"):
        simulate_plan("p", "t", [u("A")], 1_000, 1, PROFILE, [PauseWindow("A", 12, 13)], False)


def test_unknown_unit_pause_errors():
    with pytest.raises(ConfigError, match="未知单元"):
        simulate_plan("p", "t", [u("A")], 1_000, 1, PROFILE, [PauseWindow("Z", 1, 3)], False)


def test_unit_hour_status_inactive_outside_window():
    res = simulate_plan(
        "p", "t", [u("A", start=3, end=6, cap=10_000)], 100, 1, PROFILE, [], False
    )
    hours = res.days[0].units[0].hours
    assert hours[2].status == "inactive"
    assert hours[5].status == "active"
    assert hours[6].status == "inactive"


def test_allocate_by_weight_rejects_negative():
    with pytest.raises(ConfigError):
        plan_day([u("A", weight=-1)], 1_000)
