import type { HourInput } from '../types'
import { HOUR_LABEL, fmtInt } from '../format'

interface Props {
  profile: HourInput[]
  onChange: (next: HourInput[]) => void
}

export function ProfileEditor({ profile, onChange }: Props) {
  const total = profile.reduce((s, h) => s + h.available_impressions, 0)
  const avgPrice =
    profile.reduce((s, h) => s + h.price_cents, 0) / (profile.length || 1)

  const setHour = (hour: number, patch: Partial<HourInput>) => {
    onChange(profile.map((h, i) => (i === hour ? { ...h, ...patch } : h)))
  }

  const paste = (raw: string) => {
    const rows = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const parsed: HourInput[] = []
    for (const row of rows) {
      const parts = row.split(/[\s,;\t]+/)
      if (parts.length < 2) continue
      const impressions = Number(parts[parts.length - 2])
      const price = Number(parts[parts.length - 1])
      if (!Number.isFinite(impressions) || !Number.isFinite(price)) continue
      parsed.push({
        available_impressions: Math.max(0, Math.round(impressions)),
        price_cents: Math.max(1, Math.round(price)),
      })
      if (parsed.length === 24) break
    }
    if (parsed.length !== 24) {
      throw new Error(`粘贴内容需要 24 行，每行“曝光量 单价(分)”；当前解析到 ${parsed.length} 行`)
    }
    onChange(parsed)
  }

  return (
    <div className="panel panel-pad">
      <div className="section-title">
        <h2>每小时流量与单价</h2>
        <span className="hint">
          全天曝光 {fmtInt(total)} 次 · 均价 {avgPrice.toFixed(2)} 分
        </span>
      </div>

      <div className="field">
        <label>批量导入（24 行，每行“可用曝光量 单价(分)”，也可用逗号/制表符分隔）</label>
        <textarea
          className="paste"
          placeholder={'2000 50\n2000 50\n…'}
          onBlur={(e) => {
            const raw = e.target.value.trim()
            if (!raw) return
            try {
              paste(raw)
              e.target.value = ''
              e.target.setCustomValidity('')
            } catch (err) {
              // 让用户看到失败原因；保留输入便于修正。
              e.target.setCustomValidity((err as Error).message)
              e.target.reportValidity()
            }
          }}
        />
        <p className="two-col-help">
          单价为整数分，必须大于零；导入后可用下方表格逐小时微调。
        </p>
      </div>

      <div className="profile-editor">
        <table>
          <thead>
            <tr>
              <th className="left">小时</th>
              <th>可用曝光量</th>
              <th>单价（分）</th>
            </tr>
          </thead>
          <tbody>
            {profile.map((h, hour) => (
              <tr key={hour}>
                <td className="left" style={{ color: 'var(--text-secondary)' }}>
                  {HOUR_LABEL(hour)}
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={1}
                    value={h.available_impressions}
                    aria-label={`${HOUR_LABEL(hour)} 可用曝光量`}
                    onChange={(e) =>
                      setHour(hour, {
                        available_impressions: Math.max(
                          0,
                          Math.round(Number(e.target.value) || 0),
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    className={`input ${h.price_cents <= 0 ? 'invalid' : ''}`}
                    type="number"
                    min={1}
                    step={1}
                    value={h.price_cents}
                    aria-label={`${HOUR_LABEL(hour)} 单价`}
                    onChange={(e) =>
                      setHour(hour, {
                        price_cents: Math.round(Number(e.target.value) || 0),
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
