import type { SteamGuardAccount } from './account'
import { decodeSteamJwt } from './tokens'

export type SteamLoginState = 'active' | 'refreshable' | 'missing' | 'invalid'

export type SteamLoginStatus = {
  state: SteamLoginState
  message: string
  hasAccessToken: boolean
  hasRefreshToken: boolean
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  autoRefreshAvailable: boolean
  checkedAt: string | null
}

export function steamLoginStatus(account: SteamGuardAccount, input?: {
  checked?: boolean
  invalidMessage?: string
}): SteamLoginStatus {
  const hasRefreshToken = Boolean(account.tokens?.refresh_token)
  const hasAccessToken = Boolean(account.tokens?.access_token)
  const checkedAt = input?.checked ? new Date().toISOString() : null
  let refreshTokenExpiresAt: string | null = null
  if (account.tokens?.refresh_token) {
    try {
      refreshTokenExpiresAt = new Date(decodeSteamJwt(account.tokens.refresh_token).exp * 1000).toISOString()
    } catch {
      refreshTokenExpiresAt = null
    }
  }

  if (input?.invalidMessage) {
    return {
      state: 'invalid',
      message: input.invalidMessage,
      hasAccessToken,
      hasRefreshToken,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt,
      autoRefreshAvailable: false,
      checkedAt,
    }
  }

  if (!hasRefreshToken) {
    return {
      state: 'missing',
      message: 'No Steam login session is stored for this account.',
      hasAccessToken,
      hasRefreshToken,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt,
      autoRefreshAvailable: false,
      checkedAt,
    }
  }

  if (!hasAccessToken) {
    return {
      state: 'refreshable',
      message: 'Refresh token is stored; access tokens will renew automatically when Steam actions need them.',
      hasAccessToken,
      hasRefreshToken,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt,
      autoRefreshAvailable: true,
      checkedAt,
    }
  }

  try {
    const decoded = decodeSteamJwt(account.tokens!.access_token)
    const accessTokenExpiresAt = new Date(decoded.exp * 1000).toISOString()
    if (decoded.exp > Math.floor(Date.now() / 1000) + 60) {
      return {
        state: 'active',
        message: 'Steam login session is active. Short-lived access tokens renew automatically from the stored refresh token.',
        hasAccessToken,
        hasRefreshToken,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        autoRefreshAvailable: true,
        checkedAt,
      }
    }
    return {
      state: 'refreshable',
      message: 'Stored access token is expired, but a refresh token is available for automatic renewal.',
      hasAccessToken,
      hasRefreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      autoRefreshAvailable: true,
      checkedAt,
    }
  } catch {
    return {
      state: 'refreshable',
      message: 'Stored access token could not be decoded, but a refresh token is available for automatic renewal.',
      hasAccessToken,
      hasRefreshToken,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt,
      autoRefreshAvailable: true,
      checkedAt,
    }
  }
}
