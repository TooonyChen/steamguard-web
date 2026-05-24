import type { Bindings } from '../types'
import type { SteamGuardAccount } from './account'
import {
  CAuthentication_GetAuthSessionInfo_Response,
  ESessionPersistence,
} from '../generated/steam-protobuf'
import { getAuthSessionInfo, getAuthSessionsForAccount, updateAuthSessionWithMobileConfirmation } from './authentication-client'
import { parseSteamQrChallenge } from './qr-login'
import { buildLoginApprovalSignature } from './login-approval-signature'
import { ensureMobileAccessToken } from './session-tokens'
import { steamLong, longToString } from './long'

export type SessionInfoView = {
  clientId: string
  ip: string
  geoloc: string
  city: string
  state: string
  country: string
  platformType: number
  deviceFriendlyName: string
  version: number
  loginHistory: unknown
  requestorLocationMismatch: boolean
  highUsageLogin: boolean
  requestedPersistence: number
}

function shapeSessionInfo(clientId: string, response: CAuthentication_GetAuthSessionInfo_Response.$Properties): SessionInfoView {
  return {
    clientId,
    ip: response.ip ?? '',
    geoloc: response.geoloc ?? '',
    city: response.city ?? '',
    state: response.state ?? '',
    country: response.country ?? '',
    platformType: response.platformType ?? 0,
    deviceFriendlyName: response.deviceFriendlyName ?? '',
    version: response.version ?? 0,
    loginHistory: response.loginHistory ?? null,
    requestorLocationMismatch: response.requestorLocationMismatch ?? false,
    highUsageLogin: response.highUsageLogin ?? false,
    requestedPersistence: response.requestedPersistence ?? 0,
  }
}

export async function listLoginSessions(env: Bindings, accountId: string, accountKey: string, account: SteamGuardAccount): Promise<SessionInfoView[]> {
  const accessToken = await ensureMobileAccessToken(env, accountId, accountKey, account)
  const response = await getAuthSessionsForAccount({}, accessToken)
  return Promise.all((response.response.clientIds || []).map(async (clientId) => {
    const info = await getAuthSessionInfo({ clientId }, accessToken)
    return shapeSessionInfo(longToString(clientId), info.response)
  }))
}

export async function getChallengeSessionInfo(
  env: Bindings,
  accountId: string,
  accountKey: string,
  account: SteamGuardAccount,
  challenge: { version: number; clientId: string },
): Promise<SessionInfoView> {
  const accessToken = await ensureMobileAccessToken(env, accountId, accountKey, account)
  const info = await getAuthSessionInfo({ clientId: steamLong(challenge.clientId) }, accessToken)
  return shapeSessionInfo(challenge.clientId, info.response)
}

export async function approveLoginChallenge(
  env: Bindings,
  accountId: string,
  accountKey: string,
  account: SteamGuardAccount,
  input: { challengeUrl?: string; version?: number; clientId?: string; confirm: boolean; persistence?: 'persistent' | 'ephemeral' },
): Promise<void> {
  const challenge = input.challengeUrl
    ? parseSteamQrChallenge(input.challengeUrl)
    : { version: Number(input.version || 1), clientId: String(input.clientId || '') }
  if (!challenge.clientId) throw new Error('clientId or challengeUrl is required')
  const accessToken = await ensureMobileAccessToken(env, accountId, accountKey, account)
  const signature = await buildLoginApprovalSignature(account.shared_secret, account.steam_id, challenge)
  await updateAuthSessionWithMobileConfirmation({
    version: challenge.version,
    clientId: steamLong(challenge.clientId),
    steamid: steamLong(account.steam_id),
    signature,
    confirm: input.confirm,
    persistence: input.persistence === 'ephemeral'
      ? ESessionPersistence.k_ESessionPersistence_Ephemeral
      : ESessionPersistence.k_ESessionPersistence_Persistent,
  }, accessToken)
}

