import type { Bindings } from '../types'
import type { SteamGuardAccount } from './account'
import { generateConfirmationHash } from './confirmation-hash'
import { getSteamServerTime } from './time'
import { ensureMobileAccessToken } from './session-tokens'

const COMMUNITY = 'https://steamcommunity.com'

export type Confirmation = {
  type: number
  type_name: string
  id: string
  creator_id: string
  nonce: string
  creation_time: number
  cancel: string
  accept: string
  icon?: string
  multi: boolean
  headline: string
  summary: string[]
}

type ConfirmationListResponse = {
  success: boolean
  needauth?: boolean
  conf?: Confirmation[]
  message?: string
}

type ConfirmationActionResponse = {
  success: boolean
  needsauth?: boolean
  message?: string
}

function cookies(account: SteamGuardAccount, accessToken: string): string {
  return [
    'dob=',
    `steamid=${account.steam_id}`,
    `steamLoginSecure=${account.steam_id}||${accessToken}`,
  ].join('; ')
}

async function confirmationParams(account: SteamGuardAccount, tag: string): Promise<URLSearchParams> {
  const time = await getSteamServerTime()
  const params = new URLSearchParams()
  params.set('p', account.device_id)
  params.set('a', String(account.steam_id))
  params.set('k', await generateConfirmationHash(time.unixTime, tag, account.identity_secret))
  params.set('t', String(time.unixTime))
  params.set('m', 'react')
  params.set('tag', tag)
  return params
}

async function steamCommunityJson<T>(url: URL, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const text = await response.text()
  if (!response.ok) throw new Error(`Steam Community HTTP ${response.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text) as T
}

export async function listConfirmations(env: Bindings, accountId: string, accountKey: string, account: SteamGuardAccount): Promise<Confirmation[]> {
  const accessToken = await ensureMobileAccessToken(env, accountId, accountKey, account)
  const url = new URL('/mobileconf/getlist', COMMUNITY)
  url.search = (await confirmationParams(account, 'conf')).toString()
  const body = await steamCommunityJson<ConfirmationListResponse>(url, {
    headers: {
      Cookie: cookies(account, accessToken),
      'User-Agent': 'steamguard-web',
    },
  })
  if (body.needauth) throw new Error('Steam Community rejected stored mobile tokens')
  if (!body.success) throw new Error(body.message || 'Steam Community confirmation list failed')
  return body.conf || []
}

export async function getConfirmationDetails(env: Bindings, accountId: string, accountKey: string, account: SteamGuardAccount, confirmationId: string): Promise<string> {
  const accessToken = await ensureMobileAccessToken(env, accountId, accountKey, account)
  const url = new URL(`/mobileconf/details/${encodeURIComponent(confirmationId)}`, COMMUNITY)
  url.search = (await confirmationParams(account, 'details')).toString()
  const body = await steamCommunityJson<{ success: boolean; html: string }>(url, {
    headers: {
      Cookie: cookies(account, accessToken),
      'User-Agent': 'steamguard-web',
    },
  })
  if (!body.success) throw new Error('Steam Community confirmation details failed')
  return body.html
}

export async function actOnConfirmation(
  env: Bindings,
  accountId: string,
  accountKey: string,
  account: SteamGuardAccount,
  action: 'allow' | 'cancel',
  confirmation: { id: string; nonce: string },
): Promise<void> {
  const accessToken = await ensureMobileAccessToken(env, accountId, accountKey, account)
  const url = new URL('/mobileconf/ajaxop', COMMUNITY)
  const params = await confirmationParams(account, 'conf')
  params.set('op', action)
  params.set('cid', confirmation.id)
  params.set('ck', confirmation.nonce)
  url.search = params.toString()
  const body = await steamCommunityJson<ConfirmationActionResponse>(url, {
    headers: {
      Cookie: cookies(account, accessToken),
      Origin: COMMUNITY,
      'User-Agent': 'steamguard-web',
    },
  })
  if (body.needsauth) throw new Error('Steam Community rejected stored mobile tokens')
  if (!body.success) throw new Error(body.message || 'Steam Community confirmation action failed')
}

export async function actOnConfirmationsBulk(
  env: Bindings,
  accountId: string,
  accountKey: string,
  account: SteamGuardAccount,
  action: 'allow' | 'cancel',
  confirmations: Array<{ id: string; nonce: string }>,
): Promise<void> {
  if (confirmations.length === 0) return
  const accessToken = await ensureMobileAccessToken(env, accountId, accountKey, account)
  const url = new URL('/mobileconf/multiajaxop', COMMUNITY)
  const bodyParams = await confirmationParams(account, 'conf')
  bodyParams.set('op', action)
  for (const confirmation of confirmations) {
    bodyParams.append('cid[]', confirmation.id)
    bodyParams.append('ck[]', confirmation.nonce)
  }
  const body = await steamCommunityJson<ConfirmationActionResponse>(url, {
    method: 'POST',
    headers: {
      Cookie: cookies(account, accessToken),
      Origin: COMMUNITY,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'steamguard-web',
    },
    body: bodyParams.toString(),
  })
  if (body.needsauth) throw new Error('Steam Community rejected stored mobile tokens')
  if (!body.success) throw new Error(body.message || 'Steam Community bulk confirmation action failed')
}

