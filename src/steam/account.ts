export type SteamTokens = {
  access_token: string
  refresh_token: string
}

export type SteamGuardAccount = {
  account_name: string
  steam_id: number | string
  serial_number: string
  revocation_code: string
  shared_secret: string
  token_gid: string
  identity_secret: string
  uri: string
  device_id: string
  secret_1: string
  tokens?: SteamTokens | null
}

export function publicAccount(account: SteamGuardAccount) {
  return {
    account_name: account.account_name,
    steam_id: String(account.steam_id || ''),
    device_id: account.device_id,
    has_tokens: Boolean(account.tokens?.access_token && account.tokens?.refresh_token),
  }
}
