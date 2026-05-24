import type { SteamGuardAccount } from './account'
import type { CredentialFlowState, SteamTokens } from './login-flow'
import { bytesToBase64 } from '../crypto/encoding'
import { generateSteamGuardCode } from './guard-code'
import { getSteamServerTime } from './time'
import { addAuthenticator, finalizeAuthenticator, removeAuthenticatorViaChallengeContinue, removeAuthenticatorViaChallengeStart } from './twofactor-client'
import { generateDeviceId } from './device-id'
import { steamLong, longToString } from './long'

export type SetupFlowState = CredentialFlowState & {
  kind: 'setup'
  deviceId: string
  provisionalAccount?: SteamGuardAccount
  phoneNumberHint?: string
  confirmType?: number
  serverTime?: number
}

export type TransferFlowState = CredentialFlowState & {
  kind: 'transfer'
  deviceId: string
}

function tokensOrThrow(state: { tokens?: SteamTokens }): SteamTokens {
  if (!state.tokens?.access_token || !state.tokens.refresh_token) {
    throw new Error('Steam credential flow has not produced tokens yet')
  }
  return state.tokens
}

function requiredString(value: string | null | undefined, field: string): string {
  if (!value) throw new Error(`Steam response missing ${field}`)
  return value
}

function requiredBytes(value: Uint8Array | null | undefined, field: string): Uint8Array {
  if (!value) throw new Error(`Steam response missing ${field}`)
  return value
}

export async function addAuthenticatorForSetup(state: SetupFlowState): Promise<SetupFlowState> {
  const tokens = tokensOrThrow(state)
  const response = await addAuthenticator({
    steamid: steamLong(state.steamId),
    authenticatorType: 1,
    smsPhoneId: '1',
    deviceIdentifier: state.deviceId,
    version: 2,
  }, tokens.access_token)
  const data = response.response
  const account: SteamGuardAccount = {
    account_name: requiredString(data.accountName, 'account_name'),
    steam_id: state.steamId,
    serial_number: longToString(data.serialNumber ?? 0),
    revocation_code: requiredString(data.revocationCode, 'revocation_code'),
    uri: requiredString(data.uri, 'uri'),
    shared_secret: bytesToBase64(requiredBytes(data.sharedSecret, 'shared_secret')),
    token_gid: requiredString(data.tokenGid, 'token_gid'),
    identity_secret: bytesToBase64(requiredBytes(data.identitySecret, 'identity_secret')),
    device_id: state.deviceId,
    secret_1: bytesToBase64(requiredBytes(data.secret_1, 'secret_1')),
    tokens,
  }
  return {
    ...state,
    step: 'tokens_ready',
    provisionalAccount: account,
    phoneNumberHint: data.phoneNumberHint ?? undefined,
    confirmType: data.confirmType ?? undefined,
    serverTime: Number(longToString(data.serverTime || 0)),
  }
}

export async function finalizeSetupAuthenticator(state: SetupFlowState, activationCode: string): Promise<{
  state: SetupFlowState
  finalized: boolean
  wantMore: boolean
}> {
  const tokens = tokensOrThrow(state)
  if (!state.provisionalAccount) throw new Error('No provisional authenticator exists for this setup flow')
  const time = await getSteamServerTime()
  const authenticatorCode = await generateSteamGuardCode(state.provisionalAccount.shared_secret, time.unixTime)
  const response = await finalizeAuthenticator({
    steamid: steamLong(state.steamId),
    authenticatorCode,
    authenticatorTime: time.unixTime,
    activationCode,
    validateSmsCode: true,
  }, tokens.access_token)
  const nextState = {
    ...state,
    serverTime: Number(longToString(response.response.serverTime || time.unixTime)),
  }
  if (response.response.wantMore) {
    return { state: nextState, finalized: false, wantMore: true }
  }
  if (!response.response.success) {
    throw new Error(`Steam did not finalize authenticator; status=${response.response.status}`)
  }
  return { state: nextState, finalized: true, wantMore: false }
}

export function newSetupFlowState(base: CredentialFlowState, deviceId = generateDeviceId()): SetupFlowState {
  return {
    ...base,
    kind: 'setup',
    deviceId,
  }
}

export function newTransferFlowState(base: CredentialFlowState, deviceId = generateDeviceId()): TransferFlowState {
  return {
    ...base,
    kind: 'transfer',
    deviceId,
  }
}

export async function startTransferAuthenticator(state: TransferFlowState): Promise<TransferFlowState> {
  const tokens = tokensOrThrow(state)
  await removeAuthenticatorViaChallengeStart(tokens.access_token)
  return { ...state, step: 'tokens_ready' }
}

export async function finishTransferAuthenticator(state: TransferFlowState, smsCode: string): Promise<SteamGuardAccount> {
  const tokens = tokensOrThrow(state)
  const response = await removeAuthenticatorViaChallengeContinue({
    smsCode,
    generateNewToken: true,
    version: 2,
  }, tokens.access_token)
  if (!response.response.success || !response.response.replacementToken) {
    throw new Error('Steam did not return replacement authenticator token')
  }
  const replacement = response.response.replacementToken
  return {
    account_name: requiredString(replacement.accountName, 'account_name'),
    steam_id: state.steamId,
    serial_number: longToString(replacement.serialNumber ?? 0),
    revocation_code: requiredString(replacement.revocationCode, 'revocation_code'),
    uri: requiredString(replacement.uri, 'uri'),
    shared_secret: bytesToBase64(requiredBytes(replacement.sharedSecret, 'shared_secret')),
    token_gid: requiredString(replacement.tokenGid, 'token_gid'),
    identity_secret: bytesToBase64(requiredBytes(replacement.identitySecret, 'identity_secret')),
    device_id: state.deviceId,
    secret_1: bytesToBase64(requiredBytes(replacement.secret_1, 'secret_1')),
    tokens,
  }
}
