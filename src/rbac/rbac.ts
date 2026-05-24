import type { Context, Next } from 'hono'
import type { AppEnv, AuthUser } from '../types'
import { forbidden } from '../http/errors'
import { hasAccountAccess } from '../db/queries'

export type AccountCapability = 'code' | 'status'

export function assertAdmin(user: AuthUser): void {
  if (user.role !== 'admin') forbidden('Admin role required')
}

export function adminOnly(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  assertAdmin(c.get('user'))
  return next()
}

export async function assertAccountAccess(
  c: Context<AppEnv>,
  accountId: string,
  capability: AccountCapability,
): Promise<void> {
  const allowed = await hasAccountAccess(c.env, c.get('user'), accountId, capability)
  if (!allowed) forbidden('Account access denied')
}

