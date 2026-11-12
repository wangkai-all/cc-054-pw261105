import os
import tempfile

os.environ["PACING_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_samples_and_compare():
    samples = client.get("/api/samples").json()
    assert {s["key"] for s in samples} >= {"uniform", "morning_peak", "no_traffic", "midday_pause"}

    detail = client.get("/api/samples/midday_pause").json()
    body = {
        "title": "对比",
        "base_budget_cents": detail["base_budget_cents"],
        "days": 2,
        "carryover_enabled": True,
        "units": detail["units"],
        "profile": detail["profile"],
        "pauses": detail["pauses"],
    }
    res = client.post("/api/simulate", json=body)
    assert res.status_code == 200, res.text
    data = res.json()["results"]
    assert [r["plan_id"] for r in data] == ["equal", "custom"]
    assert len(data[0]["days"]) == 2

    for plan in data:
        # 等权重下所有单元权重都是 1；自定义保留配置权重
        weights = sorted(u["weight"] for u in plan["units"])
        assert all(w > 0 for w in weights)
        for day in plan["days"]:
            allocated = sum(u["budget_cents"] for u in day["units"])
            assert allocated + day["unallocated_cents"] == day["budget_cents"]
            spent = sum(u["spend_cents"] for u in day["units"])
            assert spent == day["spend_cents"]
            assert day["spend_cents"] + day["unspent_cents"] == day["budget_cents"]
            for u in day["units"]:
                assert sum(h["slice_cents"] for h in u["hours"]) == u["budget_cents"]
                assert u["floor_awarded_cents"] == min(u["floor_cents"], u["budget_cents"])

    equal_weights = [u["weight"] for u in data[0]["units"]]
    custom_weights = [u["weight"] for u in data[1]["units"]]
    assert equal_weights == [1.0, 1.0, 1.0]
    assert custom_weights == [1.0, 2.0, 1.0]


def test_config_error_returns_422():
    detail = client.get("/api/samples/uniform").json()
    detail["units"][0]["floor_cents"] = detail["base_budget_cents"] + 1
    res = client.post("/api/simulate", json={**detail, "days": 1})
    assert res.status_code == 422
    assert "保底" in res.json()["detail"]


def test_floor_over_cap_422():
    detail = client.get("/api/samples/uniform").json()
    detail["units"][0]["daily_cap_cents"] = 10
    detail["units"][0]["floor_cents"] = 100
    res = client.post("/api/simulate", json={**detail, "days": 1})
    assert res.status_code == 422
    assert "上限" in res.json()["detail"]


def test_bad_price_rejected():
    detail = client.get("/api/samples/uniform").json()
    detail["profile"][0]["price_cents"] = 0
    res = client.post("/api/simulate", json={**detail, "days": 1})
    assert res.status_code == 422
    assert "price_cents" in res.text


def test_24_hours_required():
    detail = client.get("/api/samples/uniform").json()
    detail["profile"] = detail["profile"][:10]
    res = client.post("/api/simulate", json={**detail, "days": 1})
    assert res.status_code == 422
    assert "24" in res.json()["detail"]


def test_history_records_saved():
    before = len(client.get("/api/history").json())
    detail = client.get("/api/samples/uniform").json()
    client.post("/api/simulate", json={**detail, "days": 1})
    after = client.get("/api/history").json()
    assert len(after) == before + 2
