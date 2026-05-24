export type SteamTimeResult = {
  unixTime: number
  source: 'steam' | 'worker'
}

export async function getSteamServerTime(): Promise<SteamTimeResult> {
  try {
    const response = await fetch('https://api.steampowered.com/ITwoFactorService/QueryTime/v0001/', {
      method: 'POST',
      body: new URLSearchParams({ input_json: '{}' }),
    })
    if (!response.ok) throw new Error(`Steam time HTTP ${response.status}`)
    const text = await response.text()
    const parsed = JSON.parse(text) as { response?: { server_time?: number | string } }
    const serverTime = Number(parsed.response?.server_time)
    if (!Number.isFinite(serverTime)) throw new Error('Steam time response missing server_time')
    return { unixTime: serverTime, source: 'steam' }
  } catch {
    return { unixTime: Math.floor(Date.now() / 1000), source: 'worker' }
  }
}
