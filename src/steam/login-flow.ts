import {
  EAuthSessionGuardType,
  EAuthTokenPlatformType,
  ESessionPersistence,
} from '../generated/steam-protobuf'
import { bytesToBase64 } from '../crypto/encoding'
import { encryptSteamPassword } from './crypto/rsa-password'
import {
  beginAuthSessionViaCredentials,
  fetchPasswordRsaKey,
  pollAuthSession,
  updateAuthSessionWithSteamGuardCode,
} from './authentication-client'
import { decodeSteamJwt } from './tokens'
import { deriveMobileAccessToken } from './token-refresh'
import { longToString, steamLong } from './long'

export type SteamTokens = {
  access_token: string
  refresh_token: string
}

export type CredentialFlowState = {
  step: 'await_guard' | 'poll_tokens' | 'tokens_ready'
  accountName: string
  clientId: string
  steamId: string
  requestId: string
  interval: number
  allowedConfirmations: Array<{
    confirmationType: number
    associatedMessage: string
  }>
  tokens?: SteamTokens
}

function requiredString(value: string | null | undefined, field: string): string {
  if (!value) throw new Error(`Steam response missing ${field}`)
  return value
}

function requiredBytes(value: Uint8Array | null | undefined, field: string): Uint8Array {
  if (!value) throw new Error(`Steam response missing ${field}`)
  return value
}

export async function beginCredentialLogin(input: {
  accountName: string
  password: string
  deviceName?: string
}): Promise<CredentialFlowState> {
  const rsa = await fetchPasswordRsaKey(input.accountName)
  const encryptedPassword = encryptSteamPassword(
    requiredString(rsa.response.publickeyMod, 'publickey_mod'),
    requiredString(rsa.response.publickeyExp, 'publickey_exp'),
    input.password,
  )
  const response = await beginAuthSessionViaCredentials({
    accountName: input.accountName,
    encryptedPassword,
    encryptionTimestamp: rsa.response.timestamp ?? 0,
    persistence: ESessionPersistence.k_ESessionPersistence_Persistent,
    platformType: EAuthTokenPlatformType.k_EAuthTokenPlatformType_MobileApp,
    deviceDetails: {
      deviceFriendlyName: input.deviceName || 'SteamGuard Web',
      platformType: EAuthTokenPlatformType.k_EAuthTokenPlatformType_MobileApp,
      osType: -500,
      gamingDeviceType: 528,
    },
    language: 0,
    qosLevel: 2,
  })

  return {
    step: 'await_guard',
    accountName: input.accountName,
    clientId: longToString(response.response.clientId ?? 0),
    steamId: longToString(response.response.steamid ?? 0),
    requestId: bytesToBase64(requiredBytes(response.response.requestId, 'request_id')),
    interval: response.response.interval || 2,
    allowedConfirmations: (response.response.allowedConfirmations || []).map((confirmation) => ({
      confirmationType: confirmation.confirmationType ?? EAuthSessionGuardType.k_EAuthSessionGuardType_Unknown,
      associatedMessage: confirmation.associatedMessage ?? '',
    })),
  }
}

export async function submitCredentialGuardCode(state: CredentialFlowState, input: {
  code: string
  confirmationType: number
}): Promise<CredentialFlowState> {
  if (
    input.confirmationType !== EAuthSessionGuardType.k_EAuthSessionGuardType_DeviceCode
    && input.confirmationType !== EAuthSessionGuardType.k_EAuthSessionGuardType_EmailCode
  ) {
    throw new Error('Only email and device Steam Guard codes can be submitted as code values')
  }
  await updateAuthSessionWithSteamGuardCode({
    clientId: steamLong(state.clientId),
    steamid: steamLong(state.steamId),
    code: input.code,
    codeType: input.confirmationType,
  })
  return { ...state, step: 'poll_tokens' }
}

export async function pollCredentialTokens(state: CredentialFlowState): Promise<CredentialFlowState> {
  const response = await pollAuthSession({
    clientId: steamLong(state.clientId),
    requestId: Uint8Array.from(atob(state.requestId), (char) => char.charCodeAt(0)),
  })
  const data = response.response
  if (!data.accessToken && !data.refreshToken) {
    return { ...state, step: 'poll_tokens' }
  }

  const refreshToken = data.refreshToken || state.tokens?.refresh_token || ''
  let accessToken = data.accessToken || ''
  if (!accessToken && refreshToken) {
    accessToken = await deriveMobileAccessToken(refreshToken)
  }
  if (!accessToken || !refreshToken) {
    throw new Error('Steam auth completed without usable mobile tokens')
  }
  const decoded = decodeSteamJwt(accessToken)
  return {
    ...state,
    step: 'tokens_ready',
    steamId: decoded.sub,
    tokens: {
      access_token: accessToken,
      refresh_token: refreshToken,
    },
  }
}
