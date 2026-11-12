"""预算拆分与逐小时投放回放引擎。

金额与曝光单价全部使用整数「分」。核心规则：

日预算拆分
  1. 先按配置顺序、以整数分满足每个单元的保底金额；
  2. 剩余预算按非负权重按比例分配；比例尾差按小数余数从大到小分给各单元，
     余数相同时按固定单元编号升序；
  3. 单元分配额不超过其每日上限；达到上限后不再参与后续分配；
  4. 配置错误（保底超过本单元上限、保底总和超过预算等）在拆分前抛出；
  5. 没有正权重单元、或全部达到上限时，未能分出的余额进入全局未分配金额。

逐小时回放
  - 单元日预算均分到可投小时，不足整分的尾差给时间靠前的小时；
  - 某小时没花完的预算滚到该单元后面的可投小时；不可提前支取后面的预算；
  - 一次曝光按整数次购买，支出不超过当时可用预算与流量；
  - 同一小时内多个单元共享该小时流量，按固定单元编号升序先买；
  - 暂停窗口按小时生效：处于暂停窗口的小时该单元不购买，其小时预算继续向后滚；
  - 只使用当前小时的数据，未来小时的流量/价格不会改写过去；
  - 日终该单元未花完的预算与全局未分配金额合计为当日未花余额；
    默认清零，可选结转到次日的总预算。
"""
import math
from dataclasses import dataclass, field
from fractions import Fraction

CENTS = "cents"


class ConfigError(ValueError):
    """投放配置非法。"""


@dataclass(frozen=True)
class UnitInput:
    unit_id: str
    name: str
    floor_cents: int
    weight: Fraction
    daily_cap_cents: int
    active_start_hour: int = 0
    active_end_hour: int = 24


@dataclass
class UnitPlan:
    unit_id: str
    name: str
    index: int
    floor_cents: int
    weight: Fraction
    daily_cap_cents: int
    active_start_hour: int
    active_end_hour: int
    budget_cents: int = 0
    floor_awarded_cents: int = 0
    weight_awarded_cents: int = 0
    capped: bool = False


@dataclass
class DayPlan:
    total_budget_cents: int
    units: list[UnitPlan]
    unallocated_cents: int
    floor_total_cents: int = 0


def validate_units(units: list[UnitInput], total_budget_cents: int) -> None:
    if not units:
        raise ConfigError("至少需要一个投放单元")
    if total_budget_cents <= 0:
        raise ConfigError("总预算必须为正整数分")
    seen: set[str] = set()
    floors = 0
    for u in units:
        uid = u.unit_id.strip()
        if not uid:
            raise ConfigError("单元编号不能为空")
        if uid in seen:
            raise ConfigError(f"单元编号重复: {uid}")
        seen.add(uid)
        if u.floor_cents < 0:
            raise ConfigError(f"单元 {uid} 的保底金额不能为负")
        if u.daily_cap_cents < 0:
            raise ConfigError(f"单元 {uid} 的每日上限不能为负")
        if u.weight < 0 or not math.isfinite(float(u.weight)):
            raise ConfigError(f"单元 {uid} 的权重必须是非负有限数")
        if not 0 <= u.active_start_hour < 24:
            raise ConfigError(f"单元 {uid} 的可投开始小时必须在 0..23")
        if not 0 < u.active_end_hour <= 24:
            raise ConfigError(f"单元 {uid} 的可投结束小时必须在 1..24")
        if u.active_start_hour >= u.active_end_hour:
            raise ConfigError(f"单元 {uid} 的可投时段为空")
        if u.floor_cents > u.daily_cap_cents:
            raise ConfigError(
                f"单元 {uid} 的保底金额 {u.floor_cents} 分超过本单元每日上限 "
                f"{u.daily_cap_cents} 分"
            )
        floors += u.floor_cents
    if floors > total_budget_cents:
        raise ConfigError(
            f"保底金额总和 {floors} 分超过总预算 {total_budget_cents} 分"
        )


def allocate_by_weight(pool_cents: int, candidates: list[UnitPlan]) -> list[tuple[UnitPlan, int]]:
    """按权重比例拆分整数分。

    先取地板值，剩下不足一分的尾差按小数余数降序、编号（配置顺序）升序，
    每单元最多再得 1 分。返回按传入顺序排列的 (单元, 分得金额)。
    """
    if pool_cents <= 0 or not candidates:
        return [(u, 0) for u in candidates]
    weight_sum = sum((u.weight for u in candidates), Fraction(0))
    if weight_sum <= 0:
        return [(u, 0) for u in candidates]

    shares: list[list] = []  # [unit, integer_share, remainder]
    for u in candidates:
        raw = Fraction(pool_cents) * u.weight / weight_sum
        base = raw.numerator // raw.denominator  # raw >= 0
        shares.append([u, base, raw - base])

    leftover = pool_cents - sum(s[1] for s in shares)
    # 小数余数降序；余数相同按固定单元编号升序（编号相同再按配置顺序，保证确定）。
    order = sorted(
        range(len(shares)),
        key=lambda i: (-shares[i][2], shares[i][0].unit_id, shares[i][0].index),
    )
    for k in range(leftover):
        shares[order[k]][1] += 1
    return [(s[0], s[1]) for s in shares]


def plan_day(units: list[UnitInput], total_budget_cents: int) -> DayPlan:
    """把当日预算拆到各投放单元。"""
    validate_units(units, total_budget_cents)

    plans = [
        UnitPlan(
            unit_id=u.unit_id.strip(),
            name=u.name,
            index=i,
            floor_cents=u.floor_cents,
            weight=u.weight,
            daily_cap_cents=u.daily_cap_cents,
            active_start_hour=u.active_start_hour,
            active_end_hour=u.active_end_hour,
        )
        for i, u in enumerate(units)
    ]
    floor_total = sum(p.floor_cents for p in plans)
    remaining = total_budget_cents

    # 1. 保底优先，按配置顺序、受单元上限约束。
    for p in plans:
        grant = min(p.floor_cents, p.daily_cap_cents, remaining)
        p.budget_cents = grant
        p.floor_awarded_cents = grant
        remaining -= grant
        if p.budget_cents >= p.daily_cap_cents:
            p.capped = True

    # 2. 余额按非负权重分配；到上限的单元退出后续分配。
    cap = len(plans) + 1  # 每轮至少会封顶一个单元，循环有上界
    while remaining > 0 and cap > 0:
        cap -= 1
        candidates = [p for p in plans if p.weight > 0 and not p.capped]
        if not candidates:
            break
        awards = allocate_by_weight(remaining, candidates)
        if not any(a for _, a in awards):
            # 余额不足以让任何单元再得 1 分（例如只剩 1 分但余数并列，
            # 已由尾差规则分给编号最靠前的单元），不会再有进展。
            break
        overflow = 0
        for p, award in awards:
            room = p.daily_cap_cents - p.budget_cents - p.weight_awarded_cents
            take = min(award, room)
            p.weight_awarded_cents += take
            remaining -= take
            overflow += award - take
            if p.budget_cents + p.weight_awarded_cents >= p.daily_cap_cents:
                p.capped = True
        if overflow == 0:
            break
        # 有单元因上限退回余额，继续下一轮按权重分给仍有空间的单元。
    # 若剩余单元的权重全为 0 或全部到上限，remaining 保留为全局未分配金额。

    for p in plans:
        p.budget_cents += p.weight_awarded_cents

    return DayPlan(
        total_budget_cents=total_budget_cents,
        units=plans,
        unallocated_cents=remaining,
        floor_total_cents=floor_total,
    )


def split_across_hours(budget_cents: int, start_hour: int, end_hour: int) -> dict[int, int]:
    """把单元日预算均分到可投小时。

    不足整分的尾差按时间靠前的小时优先各得 1 分。
    """
    hours = end_hour - start_hour
    if hours <= 0 or budget_cents <= 0:
        return {}
    base, extra = divmod(budget_cents, hours)
    return {
        start_hour + i: base + (1 if i < extra else 0)
        for i in range(hours)
    }


# ---------------------------------------------------------------------------
# 逐小时回放
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HourData:
    available_impressions: int
    price_cents: int


@dataclass(frozen=True)
class PauseWindow:
    """暂停申请发生在 requested_hour 这一小时，从下一小时起生效，至 end_hour 恢复。"""

    unit_id: str
    requested_hour: int
    end_hour: int

    @property
    def effective_start_hour(self) -> int:
        return self.requested_hour + 1


@dataclass
class UnitHourResult:
    hour: int
    status: str  # active / paused / inactive
    slice_cents: int
    rolled_in_cents: int
    available_cents: int
    purchased_impressions: int
    spend_cents: int
    rolled_out_cents: int
    traffic_available: int
    traffic_left_after: int
    price_cents: int


@dataclass
class UnitDayResult:
    unit_id: str
    name: str
    index: int
    budget_cents: int
    floor_cents: int
    weight: float
    daily_cap_cents: int
    active_start_hour: int
    active_end_hour: int
    capped: bool
    spend_cents: int
    purchased_impressions: int
    unspent_cents: int
    floor_awarded_cents: int = 0
    weight_awarded_cents: int = 0
    hours: list[UnitHourResult] = field(default_factory=list)


@dataclass
class HourResult:
    hour: int
    traffic_available: int
    price_cents: int
    traffic_left: int
    spend_cents: int
    purchased_impressions: int
    units: list[dict] = field(default_factory=list)


@dataclass
class DayResult:
    day_index: int
    base_budget_cents: int
    carryover_in_cents: int
    budget_cents: int
    unallocated_cents: int
    floor_total_cents: int
    spend_cents: int
    purchased_impressions: int
    unspent_cents: int
    units: list[UnitDayResult] = field(default_factory=list)
    hours: list[HourResult] = field(default_factory=list)


@dataclass
class PlanResult:
    plan_id: str
    title: str
    carryover_enabled: bool
    units: list[UnitDayResult] | list
    days: list[DayResult] = field(default_factory=list)
    total_budget_cents: int = 0
    total_spend_cents: int = 0
    total_impressions: int = 0
    total_unspent_cents: int = 0


def _pause_windows_for(unit_id: str, pauses: list[PauseWindow]) -> list[tuple[int, int]]:
    return [
        (p.effective_start_hour, p.end_hour) for p in pauses if p.unit_id == unit_id
    ]


def _is_paused(hour: int, windows: list[tuple[int, int]]) -> bool:
    return any(start <= hour < end for start, end in windows)


def simulate_plan(
    plan_id: str,
    title: str,
    units: list[UnitInput],
    base_budget_cents: int,
    days: int,
    profile: list[HourData],
    pauses: list[PauseWindow],
    carryover_enabled: bool,
) -> PlanResult:
    """连续回放多天。

    carryover_enabled 为真时，前一日未花余额（含全局未分配金额）加到次日总预算；
    为假时每天从 base_budget_cents 重新开始，未花余额清零。
    """
    if days < 1:
        raise ConfigError("回放天数至少为 1")
    if len(profile) != 24:
        raise ConfigError("每小时流量数据必须覆盖 0..23 共 24 个小时")
    for h, data in enumerate(profile):
        if data.price_cents <= 0:
            raise ConfigError(f"{h} 点的曝光单价必须为正整数分")
        if data.available_impressions < 0:
            raise ConfigError(f"{h} 点的可用曝光量不能为负")
    for p in pauses:
        if not 0 <= p.requested_hour < 24:
            raise ConfigError(f"单元 {p.unit_id} 的暂停申请小时必须在 0..23")
        if not p.requested_hour + 1 < p.end_hour <= 24:
            raise ConfigError(
                f"单元 {p.unit_id} 的暂停恢复小时必须晚于生效小时 "
                f"({p.requested_hour + 1}:00) 且不超过 24:00"
            )
    known = {u.unit_id.strip() for u in units}
    for p in pauses:
        if p.unit_id not in known:
            raise ConfigError(f"暂停配置引用了未知单元: {p.unit_id}")

    # 先校验基础预算与保底等配置；具体每日预算（含结转）在逐日循环中再校验。
    validate_units(units, base_budget_cents)

    result = PlanResult(
        plan_id=plan_id,
        title=title,
        carryover_enabled=carryover_enabled,
        units=[],
    )

    carryover = 0
    for day_index in range(days):
        day_budget = base_budget_cents + (carryover if carryover_enabled else 0)
        plan = plan_day(units, day_budget)

        unit_results: dict[str, UnitDayResult] = {}
        slices: dict[str, dict[int, int]] = {}
        for up in plan.units:
            ur = UnitDayResult(
                unit_id=up.unit_id,
                name=up.name,
                index=up.index,
                budget_cents=up.budget_cents,
                floor_cents=up.floor_cents,
                weight=float(up.weight),
                daily_cap_cents=up.daily_cap_cents,
                active_start_hour=up.active_start_hour,
                active_end_hour=up.active_end_hour,
                capped=up.capped,
                spend_cents=0,
                purchased_impressions=0,
                unspent_cents=0,
                floor_awarded_cents=up.floor_awarded_cents,
                weight_awarded_cents=up.weight_awarded_cents,
            )
            unit_results[up.unit_id] = ur
            slices[up.unit_id] = split_across_hours(
                up.budget_cents, up.active_start_hour, up.active_end_hour
            )

        day = DayResult(
            day_index=day_index,
            base_budget_cents=base_budget_cents,
            carryover_in_cents=carryover if carryover_enabled else 0,
            budget_cents=day_budget,
            unallocated_cents=plan.unallocated_cents,
            floor_total_cents=plan.floor_total_cents,
            spend_cents=0,
            purchased_impressions=0,
            unspent_cents=0,
            units=sorted(unit_results.values(), key=lambda r: r.index),
        )

        # 同一小时的流量按固定单元编号顺序购买，与配置顺序无关。
        ordered_units = sorted(plan.units, key=lambda up: (up.unit_id.strip(), up.index))
        rollover: dict[str, int] = {up.unit_id: 0 for up in plan.units}

        for hour in range(24):
            data = profile[hour]
            traffic_left = data.available_impressions
            hour_result = HourResult(
                hour=hour,
                traffic_available=data.available_impressions,
                price_cents=data.price_cents,
                traffic_left=traffic_left,
                spend_cents=0,
                purchased_impressions=0,
            )

            for up in ordered_units:
                ur = unit_results[up.unit_id]
                in_window = up.active_start_hour <= hour < up.active_end_hour
                paused_windows = _pause_windows_for(up.unit_id, pauses)
                if not in_window:
                    status = "inactive"
                elif _is_paused(hour, paused_windows):
                    status = "paused"
                else:
                    status = "active"

                slice_cents = slices[up.unit_id].get(hour, 0) if in_window else 0
                rolled_in = rollover[up.unit_id]

                if status == "active":
                    available = rolled_in + slice_cents
                    # 只在本小时的数据内购买；整数次，不超预算、不超流量。
                    max_by_traffic = traffic_left
                    max_by_budget = available // data.price_cents
                    purchased = min(max_by_traffic, max_by_budget)
                    spend = purchased * data.price_cents
                    traffic_left -= purchased
                    rolled_out = available - spend
                    ur.spend_cents += spend
                    ur.purchased_impressions += purchased
                    hour_result.spend_cents += spend
                    hour_result.purchased_impressions += purchased
                else:
                    # 未投放的小时（暂停或不在可投时段）预算不花，继续向后滚。
                    available = rolled_in + slice_cents
                    purchased = 0
                    spend = 0
                    rolled_out = available

                rollover[up.unit_id] = rolled_out
                ur.hours.append(
                    UnitHourResult(
                        hour=hour,
                        status=status,
                        slice_cents=slice_cents,
                        rolled_in_cents=rolled_in,
                        available_cents=available,
                        purchased_impressions=purchased,
                        spend_cents=spend,
                        rolled_out_cents=rolled_out,
                        traffic_available=data.available_impressions,
                        traffic_left_after=traffic_left,
                        price_cents=data.price_cents,
                    )
                )
                hour_result.units.append(
                    {
                        "unit_id": up.unit_id,
                        "index": up.index,
                        "status": status,
                        "slice_cents": slice_cents,
                        "rolled_in_cents": rolled_in,
                        "available_cents": available,
                        "purchased_impressions": purchased,
                        "spend_cents": spend,
                        "rolled_out_cents": rolled_out,
                        "price_cents": data.price_cents,
                        "traffic_left_after": traffic_left,
                    }
                )

            hour_result.traffic_left = traffic_left
            day.hours.append(hour_result)

        day_spend = sum(ur.spend_cents for ur in unit_results.values())
        day_impressions = sum(ur.purchased_impressions for ur in unit_results.values())
        for ur in unit_results.values():
            ur.unspent_cents = ur.budget_cents - ur.spend_cents
        day.spend_cents = day_spend
        day.purchased_impressions = day_impressions
        # 全局未分配金额也没有花掉，与自己日终未花余额一起构成当日未花余额。
        day.unspent_cents = day_budget - day_spend
        carryover = day.unspent_cents if carryover_enabled else 0

        result.days.append(day)
        result.total_budget_cents += day_budget
        result.total_spend_cents += day_spend
        result.total_impressions += day_impressions
        result.total_unspent_cents += day.unspent_cents

    return result
