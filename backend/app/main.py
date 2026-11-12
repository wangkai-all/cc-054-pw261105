"""FastAPI 应用：两个方案（等权重 / 自定义权重）共享流量与价格。"""
from fractions import Fraction
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import db, samples
from .engine import (
    ConfigError,
    HourData,
    PauseWindow,
    UnitInput,
    simulate_plan,
)

app = FastAPI(title="投放预算回放", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class UnitIn(BaseModel):
    unit_id: str
    name: str = ""
    floor_cents: int = 0
    weight: float = 1.0
    daily_cap_cents: int
    active_start_hour: int = 0
    active_end_hour: int = 24


class HourIn(BaseModel):
    available_impressions: int = Field(ge=0)
    price_cents: int = Field(gt=0)


class PauseIn(BaseModel):
    unit_id: str
    requested_hour: int = Field(ge=0, lt=23)
    end_hour: int = Field(gt=0, le=24)


class CompareIn(BaseModel):
    title: str = "方案对比"
    base_budget_cents: int = Field(gt=0)
    days: int = Field(default=1, ge=1, le=90)
    carryover_enabled: bool = False
    units: list[UnitIn]
    profile: list[HourIn]
    pauses: list[PauseIn] = []


def _units(units: list[UnitIn], equal: bool) -> list[UnitInput]:
    return [
        UnitInput(
            unit_id=u.unit_id,
            name=u.name or u.unit_id,
            floor_cents=u.floor_cents,
            weight=Fraction(1) if equal else Fraction(str(u.weight)),
            daily_cap_cents=u.daily_cap_cents,
            active_start_hour=u.active_start_hour,
            active_end_hour=u.active_end_hour,
        )
        for u in units
    ]


def _profile(profile: list[HourIn]) -> list[HourData]:
    if len(profile) != 24:
        raise ConfigError("每小时流量数据必须覆盖 0..23 共 24 个小时")
    return [
        HourData(available_impressions=h.available_impressions, price_cents=h.price_cents)
        for h in profile
    ]


def _pauses(pauses: list[PauseIn]) -> list[PauseWindow]:
    return [PauseWindow(p.unit_id, p.requested_hour, p.end_hour) for p in pauses]


def _serialize(result, units: list[UnitInput]) -> dict:
    days = []
    for day in result.days:
        unit_payloads = []
        for unit in day.units:
            hours = [
                {
                    "hour": h.hour,
                    "status": h.status,
                    "slice_cents": h.slice_cents,
                    "rolled_in_cents": h.rolled_in_cents,
                    "available_cents": h.available_cents,
                    "purchased_impressions": h.purchased_impressions,
                    "spend_cents": h.spend_cents,
                    "rolled_out_cents": h.rolled_out_cents,
                    "traffic_available": h.traffic_available,
                    "traffic_left_after": h.traffic_left_after,
                    "price_cents": h.price_cents,
                }
                for h in unit.hours
            ]
            unit_payloads.append(
                {
                    "unit_id": unit.unit_id,
                    "name": unit.name,
                    "index": unit.index,
                    "budget_cents": unit.budget_cents,
                    "floor_cents": unit.floor_cents,
                    "floor_awarded_cents": unit.floor_awarded_cents,
                    "weight_awarded_cents": unit.weight_awarded_cents,
                    "weight": unit.weight,
                    "daily_cap_cents": unit.daily_cap_cents,
                    "active_start_hour": unit.active_start_hour,
                    "active_end_hour": unit.active_end_hour,
                    "capped": unit.capped,
                    "spend_cents": unit.spend_cents,
                    "purchased_impressions": unit.purchased_impressions,
                    "unspent_cents": unit.unspent_cents,
                    "hours": hours,
                }
            )
        days.append(
            {
                "day_index": day.day_index,
                "base_budget_cents": day.base_budget_cents,
                "carryover_in_cents": day.carryover_in_cents,
                "budget_cents": day.budget_cents,
                "unallocated_cents": day.unallocated_cents,
                "floor_total_cents": day.floor_total_cents,
                "spend_cents": day.spend_cents,
                "purchased_impressions": day.purchased_impressions,
                "unspent_cents": day.unspent_cents,
                "units": unit_payloads,
                "hours": [
                    {
                        "hour": hr.hour,
                        "traffic_available": hr.traffic_available,
                        "price_cents": hr.price_cents,
                        "traffic_left": hr.traffic_left,
                        "spend_cents": hr.spend_cents,
                        "purchased_impressions": hr.purchased_impressions,
                        "units": hr.units,
                    }
                    for hr in day.hours
                ],
            }
        )
    return {
        "plan_id": result.plan_id,
        "title": result.title,
        "carryover_enabled": result.carryover_enabled,
        "units": [
            {
                "unit_id": u.unit_id,
                "name": u.name,
                "index": i,
                "floor_cents": u.floor_cents,
                "weight": float(u.weight),
                "daily_cap_cents": u.daily_cap_cents,
                "active_start_hour": u.active_start_hour,
                "active_end_hour": u.active_end_hour,
            }
            for i, u in enumerate(units)
        ],
        "days": days,
        "total_budget_cents": result.total_budget_cents,
        "total_spend_cents": result.total_spend_cents,
        "total_impressions": result.total_impressions,
        "total_unspent_cents": result.total_unspent_cents,
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/samples")
def list_samples():
    return [
        {"key": k, "name": v["name"], "description": v["description"]}
        for k, v in samples.SAMPLES.items()
    ]


@app.get("/api/samples/{key}")
def sample_detail(key: str):
    if key not in samples.SAMPLES:
        raise HTTPException(404, "样例不存在")
    return samples.get_sample(key)


@app.post("/api/simulate")
def simulate(body: CompareIn):
    if len(body.profile) != 24:
        raise HTTPException(422, "每小时流量数据必须覆盖 0..23 共 24 个小时")
    try:
        profile = _profile(body.profile)
        pauses = _pauses(body.pauses)
        out = []
        for key, equal in (("equal", True), ("custom", False)):
            units = _units(body.units, equal)
            result = simulate_plan(
                plan_id=key,
                title=f"{body.title} · {'等权重' if equal else '自定义权重'}",
                units=units,
                base_budget_cents=body.base_budget_cents,
                days=body.days,
                profile=profile,
                pauses=pauses,
                carryover_enabled=body.carryover_enabled,
            )
            out.append(_serialize(result, units))
            db.save_simulation(
                {
                    "title": result.title,
                    "carryover_enabled": body.carryover_enabled,
                    "days": body.days,
                    "base_budget_cents": body.base_budget_cents,
                    "units": [u.model_dump() for u in body.units],
                    "profile": [h.model_dump() for h in body.profile],
                    "pauses": [p.model_dump() for p in body.pauses],
                },
                {
                    "total_budget_cents": result.total_budget_cents,
                    "total_spend_cents": result.total_spend_cents,
                    "total_impressions": result.total_impressions,
                },
            )
        return {"results": out}
    except ConfigError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/history")
def history():
    return db.list_simulations()
