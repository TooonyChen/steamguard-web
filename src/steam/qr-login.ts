export type SteamQrChallenge = {
  version: number
  clientId: string
}

export function parseSteamQrChallenge(url: string): SteamQrChallenge {
  const parsed = new URL(url)
  if (parsed.hostname !== 's.team') throw new Error('Invalid Steam QR host')
  const match = parsed.pathname.match(/^\/q\/(\d+)\/(\d+)$/)
  if (!match) throw new Error('Invalid Steam QR challenge URL')
  return {
    version: Number(match[1]),
    clientId: match[2],
  }
}
