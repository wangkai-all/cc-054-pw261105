"""样例场景：均匀流量、上午集中、无流量、中途暂停。

单日原始预算 40,000 分（400 元），三个投放单元：
  A 早间（可投 0-12 点，保底 8,000，上限 20,000，权重 1）
  B 全天（可投 0-24 点，保底 6,000，上限 20,000，权重 2）
  C 晚间（可投 12-24 点，保底 4,000，上限 20,000，权重 1）

保底合计 18,000 分，其余 22,000 分按 1:2:1 分配（A 5,500 / B 11,000 / C 5,500），
A 累计 13,500、B 17,000、C 9,500，均未触顶 20,000，无全局未分配金额。
"""
from .engine import HourData, PauseWindow, UnitInput
from fractions import Fraction

BASE_BUDGET_CENTS = 40_000

UNITS = [
    UnitInput("A", "早间主力", floor_cents=8_000, weight=Fraction(1),
              daily_cap_cents=20_000, active_start_hour=0, active_end_hour=12),
    UnitInput("B", "全天稳态", floor_cents=6_000, weight=Fraction(2),
              daily_cap_cents=20_000, active_start_hour=0, active_end_hour=24),
    UnitInput("C", "晚间补充", floor_cents=4_000, weight=Fraction(1),
              daily_cap_cents=20_000, active_start_hour=12, active_end_hour=24),
]

# 单价固定 50 分/次曝光（0.5 元）。
PRICE_CENTS = 50


def _profile(impressions_by_hour: dict[int, int]) -> list[HourData]:
    return [HourData(impressions_by_hour.get(h, 0), PRICE_CENTS) for h in range(24)]


def uniform_profile() -> list[HourData]:
    return _profile({h: 2_000 for h in range(24)})


def morning_peak_profile() -> list[HourData]:
    by_hour = {}
    for h in range(24):
        if 6 <= h < 12:
            by_hour[h] = 8_000
        elif 12 <= h < 18:
            by_hour[h] = 1_200
        else:
            by_hour[h] = 300
    return _profile(by_hour)


def no_traffic_profile() -> list[HourData]:
    return _profile({h: 0 for h in range(24)})


def budget_detail_profile() -> list[HourData]:
    """逐小时展开用的混合流量：上午密集、午后平缓、晚间小高峰。"""
    by_hour = {h: 0 for h in range(24)}
    for h in range(6, 12):
        by_hour[h] = 9_000
    for h in range(12, 18):
        by_hour[h] = 2_500
    for h in range(18, 24):
        by_hour[h] = 4_000
    for h in range(0, 6):
        by_hour[h] = 400
    return _profile(by_hour)


SAMPLES = {
    "uniform": {
        "name": "均匀流量",
        "description": "24 小时每小时 2,000 次曝光，单价 50 分；观察均分与尾差。",
        "profile": uniform_profile,
        "pauses": [],
    },
    "morning_peak": {
        "name": "上午集中",
        "description": "6-12 点每小时 8,000 次曝光，午后与夜间流量稀少；早间单元先吃满。",
        "profile": morning_peak_profile,
        "pauses": [],
    },
    "no_traffic": {
        "name": "无流量",
        "description": "全天无可用曝光；预算全部成为未花余额，启用结转时滚到次日。",
        "profile": no_traffic_profile,
        "pauses": [],
    },
    "midday_pause": {
        "name": "中途暂停",
        "description": "B 单元在 8 点申请暂停，从 9 点起生效、12 点恢复；暂停小时的预算滚到 12 点后。",
        "profile": budget_detail_profile,
        "pauses": [PauseWindow("B", 8, 12)],
    },
    "detail": {
        "name": "预算明细演示",
        "description": "混合流量，用于逐小时展开预算来源、购买与余款去向。",
        "profile": budget_detail_profile,
        "pauses": [PauseWindow("B", 8, 12)],
    },
}


def get_sample(key: str) -> dict:
    s = SAMPLES[key]
    return {
        "key": key,
        "name": s["name"],
        "description": s["description"],
        "base_budget_cents": BASE_BUDGET_CENTS,
        "profile": [
            {"available_impressions": d.available_impressions, "price_cents": d.price_cents}
            for d in s["profile"]()
        ],
        "pauses": [
            {
                "unit_id": p.unit_id,
                "requested_hour": p.requested_hour,
                "end_hour": p.end_hour,
                "effective_start_hour": p.effective_start_hour,
            }
            for p in s["pauses"]
        ],
        "units": units_payload(),
    }


def units_payload() -> list[dict]:
    return [
        {
            "unit_id": u.unit_id,
            "name": u.name,
            "floor_cents": u.floor_cents,
            "weight": float(u.weight),
            "daily_cap_cents": u.daily_cap_cents,
            "active_start_hour": u.active_start_hour,
            "active_end_hour": u.active_end_hour,
        }
        for u in UNITS
    ]
