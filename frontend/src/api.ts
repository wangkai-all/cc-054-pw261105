export const api = {
  async samples(): Promise<import('./types').SampleSummary[]> {
    const res = await fetch('/api/samples')
    if (!res.ok) throw new Error('样例加载失败')
    return res.json()
  },
  async sample(key: string): Promise<
    import('./types').SimulationForm & {
      key: string
      name: string
      description: string
    }
  > {
    const res = await fetch(`/api/samples/${key}`)
    if (!res.ok) throw new Error('样例加载失败')
    return res.json()
  },
  async simulate(
    body: import('./types').SimulationForm,
  ): Promise<{ results: import('./types').PlanResult[] }> {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let msg = `请求失败 (${res.status})`
      try {
        const data = await res.json()
        if (typeof data.detail === 'string') msg = data.detail
        else if (Array.isArray(data.detail))
          msg = data.detail.map((d: { msg: string }) => d.msg).join('；')
      } catch {
        /* 保留默认错误信息 */
      }
      throw new Error(msg)
    }
    return res.json()
  },
}
