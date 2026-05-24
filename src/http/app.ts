import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { z } from 'zod'
import { EAuthSessionGuardType } from '../generated/steam-protobuf'
import type { AppEnv, UserRow } from '../types'
import { audit } from '../audit/audit'
import { createSession, revokeSession, authMiddleware, currentFreshUser } from '../auth/session'
import { createUser, activeAdminCount, findUserById, findUserByUsername, listAccountsForUser, toAuthUser } from '../db/queries'
import { createEncryptedAccount, decryptAccountSecret, grantAccountToUser, revokeAccountFromUser, saveAccountSecret } from '../db/accounts'
import { loadAccountKeyForUser } from '../vault/vault'
import { hashPassword, nowIso, verifyPassword } from '../crypto/webcrypto'
import { jsonError, badRequest, forbidden, notFound, conflict } from './errors'
import { assertAccountAccess, assertAdmin } from '../rbac/rbac'
import { parseMaFile, serializeFullMaFile } from '../steam/mafile'
import { publicAccount } from '../steam/account'
import { generateSteamGuardCode, secondsRemaining } from '../steam/guard-code'
import { getSteamServerTime } from '../steam/time'
import { createEncryptedFlow, loadEncryptedFlow, updateEncryptedFlow } from '../flows/flow-store'
import { beginCredentialLogin, pollCredentialTokens, submitCredentialGuardCode, type CredentialFlowState } from '../steam/login-flow'
import {
  addAuthenticatorForSetup,
  finalizeSetupAuthenticator,
  finishTransferAuthenticator,
  newSetupFlowState,
  newTransferFlowState,
  startTransferAuthenticator,
  type SetupFlowState,
  type TransferFlowState,
} from '../steam/authenticator-flows'
import { actOnConfirmation, actOnConfirmationsBulk, getConfirmationDetails, listConfirmations } from '../steam/confirmations'
import { approveLoginChallenge, getChallengeSessionInfo, listLoginSessions } from '../steam/login-approvals'
import { parseSteamQrChallenge } from '../steam/qr-login'
import { removeAuthenticator } from '../steam/twofactor-client'
import { ensureMobileAccessToken } from '../steam/session-tokens'
import { steamLoginStatus } from '../steam/login-status'
import { SteamApiError } from '../steam/webapi-transport'
import { EResult } from '../steam/eresult'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
})

const usernameSchema = z.object({
  username: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  displayName: z.string().max(120).optional().nullable(),
})

const createViewerSchema = z.object({
  username: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  displayName: z.string().max(120).optional().nullable(),
  password: z.string().min(10),
})

const resetPasswordSchema = z.object({
  password: z.string().min(10),
})

const assignAccountSchema = z.object({
  userId: z.string().min(1),
  canViewCode: z.boolean().optional(),
  canViewStatus: z.boolean().optional(),
})

const importMaFileSchema = z.object({
  maFile: z.union([z.string(), z.record(z.string(), z.unknown())]),
})

const credentialFlowSchema = z.object({
  accountName: z.string().min(1),
  password: z.string().min(1),
  deviceName: z.string().max(120).optional(),
})

const accountSteamLoginBeginSchema = z.object({
  password: z.string().min(1),
  deviceName: z.string().max(120).optional(),
})

const guardCodeSchema = z.object({
  code: z.string().min(1),
  confirmationType: z.number().int(),
})

const activationCodeSchema = z.object({
  activationCode: z.string().min(1),
})

const smsCodeSchema = z.object({
  smsCode: z.string().min(1),
})

const confirmationActionSchema = z.object({
  nonce: z.string().min(1),
})

const bulkConfirmationSchema = z.object({
  action: z.enum(['allow', 'cancel']),
  confirmations: z.array(z.object({ id: z.string().min(1), nonce: z.string().min(1) })),
})

const loginApprovalSchema = z.object({
  challengeUrl: z.string().url().optional(),
  version: z.number().int().optional(),
  clientId: z.string().optional(),
  confirm: z.boolean().default(true),
  persistence: z.enum(['persistent', 'ephemeral']).optional(),
})

const challengeInfoSchema = z.object({
  challengeUrl: z.string().url().optional(),
  version: z.number().int().optional(),
  clientId: z.string().optional(),
})

const removeAuthenticatorSchema = z.object({
  revocationCode: z.string().optional(),
})

function jsonOk<T>(data: T) {
  return { ok: true, data }
}

async function parseJson<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch(() => badRequest('Invalid JSON body'))
  const parsed = schema.safeParse(raw)
  if (!parsed.success) badRequest(parsed.error.issues.map((issue) => issue.message).join('; '))
  return parsed.data
}

function requestIp(c: Context<AppEnv>): string | null {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null
}

function requestUserAgent(c: Context<AppEnv>): string | null {
  return c.req.header('user-agent') ?? null
}

function sanitizeDownloadName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '')
  return `${cleaned || 'steam-account'}.maFile`
}

function toPublicUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  }
}

async function assertMutableAdminTarget(env: AppEnv['Bindings'], target: UserRow): Promise<void> {
  if (target.role !== 'admin' || target.status !== 'active') return
  const count = await activeAdminCount(env)
  if (count <= 1) forbidden('Cannot modify the last active admin')
}

function requireSecrets(env: AppEnv['Bindings']): void {
  if (!env.APP_SECRET) {
    throw new Error('APP_SECRET must be configured')
  }
}

function assertSameOriginForStateChange(c: Context<AppEnv>): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return
  const origin = c.req.header('origin')
  if (!origin) return
  const requestUrl = new URL(c.req.url)
  const originUrl = new URL(origin)
  if (originUrl.host !== requestUrl.host || originUrl.protocol !== requestUrl.protocol) forbidden('Cross-origin request denied')
}

function requiredParam(c: Context<AppEnv>, name: string): string {
  const value = c.req.param(name)
  if (!value) badRequest(`Missing route parameter: ${name}`)
  return value
}

function translateLoginApprovalError(err: unknown): never {
  if (err instanceof SteamApiError) {
    if (err.result === EResult.DuplicateRequest || err.result === EResult.Expired || err.result === EResult.AlreadyRedeemed) {
      badRequest('This Steam QR challenge is no longer valid. Refresh the QR on the Steam login page and try again.')
    }
  }
  translateSteamSessionError(err)
}

function translateSteamSessionError(err: unknown): never {
  if (err instanceof SteamApiError) {
    if (err.result === EResult.AccessDenied || err.result === EResult.NotLoggedOn) {
      badRequest('Steam login session expired or invalid. Log in to Steam again to enable confirmations and login approvals.', 'steam_login_invalid')
    }
  }
  if (err instanceof Error && err.message.includes('no stored refresh token')) {
    badRequest('This account has no Steam login session. Log in to Steam once to enable confirmations and login approvals.', 'steam_login_required')
  }
  throw err
}

type AccountSteamLoginFlowState = CredentialFlowState & {
  accountId: string
}

function assertFlowAccount(flowAccountId: string | null, accountId: string): void {
  if (flowAccountId !== accountId) forbidden('Flow belongs to a different Steam account')
}

async function submitStoredDeviceCodeIfAllowed(state: AccountSteamLoginFlowState, sharedSecret: string): Promise<{
  state: AccountSteamLoginFlowState
  autoSubmittedGuardCode: boolean
}> {
  const canUseStoredDeviceCode = state.allowedConfirmations.some(
    (confirmation) => confirmation.confirmationType === EAuthSessionGuardType.k_EAuthSessionGuardType_DeviceCode,
  )
  if (!canUseStoredDeviceCode) return { state, autoSubmittedGuardCode: false }
  const time = await getSteamServerTime()
  const code = await generateSteamGuardCode(sharedSecret, time.unixTime)
  const next = await submitCredentialGuardCode(state, {
    code,
    confirmationType: EAuthSessionGuardType.k_EAuthSessionGuardType_DeviceCode,
  }) as AccountSteamLoginFlowState
  return { state: next, autoSubmittedGuardCode: true }
}

async function parseMaFileImport(c: Context<AppEnv>): Promise<string | Record<string, unknown>> {
  const contentType = c.req.header('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData().catch(() => badRequest('Invalid multipart form data'))
    const value = form.get('maFile') ?? form.get('file')
    if (!value) badRequest('maFile upload is required')
    if (typeof value === 'string') return value
    return value.text()
  }
  const input = await parseJson(c, importMaFileSchema)
  return input.maFile
}

export function createApp() {
  const app = new Hono<AppEnv>()

  app.onError((error, c) => jsonError(c, error))

  app.use('/api/*', async (c, next) => {
    assertSameOriginForStateChange(c)
    if (c.req.path !== '/api/health') requireSecrets(c.env)
    await next()
  })

  app.get('/api/health', (c) => c.json(jsonOk({
    environment: c.env.ENVIRONMENT ?? 'development',
    service: 'steamguard-web',
    time: nowIso(),
  })))

  app.post('/api/auth/login', async (c) => {
    const input = await parseJson(c, loginSchema)
    const row = await findUserByUsername(c.env, input.username)
    if (!row || row.status !== 'active') {
      await audit(c.env, {
        action: 'login_failed',
        outcome: 'failure',
        metadata: { username: input.username },
        ip: requestIp(c),
        userAgent: requestUserAgent(c),
      })
      forbidden('Invalid username or password')
    }
    const valid = await verifyPassword(input.password, row.password_salt, row.password_hash, row.password_hash_scheme)
    if (!valid) {
      await audit(c.env, {
        actorUserId: row.id,
        action: 'login_failed',
        outcome: 'failure',
        ip: requestIp(c),
        userAgent: requestUserAgent(c),
      })
      forbidden('Invalid username or password')
    }
    await createSession(c, row.id)
    await c.env.DB.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').bind(nowIso(), nowIso(), row.id).run()
    await audit(c.env, {
      actorUserId: row.id,
      action: 'login_succeeded',
      outcome: 'success',
      ip: requestIp(c),
      userAgent: requestUserAgent(c),
    })
    return c.json(jsonOk({ user: toAuthUser(row) }))
  })

  app.post('/api/auth/logout', authMiddleware, async (c) => {
    await revokeSession(c)
    return c.json(jsonOk({ loggedOut: true }))
  })

  app.get('/api/auth/me', authMiddleware, async (c) => {
    return c.json(jsonOk({ user: c.get('user'), secretAccess: true }))
  })

  app.patch('/api/me/password', authMiddleware, async (c) => {
    const input = await parseJson(c, passwordSchema)
    const row = await currentFreshUser(c)
    const valid = await verifyPassword(input.currentPassword, row.password_salt, row.password_hash, row.password_hash_scheme)
    if (!valid) forbidden('Current password is incorrect')
    const hashed = await hashPassword(input.newPassword)
    await c.env.DB
      .prepare(
        `UPDATE users
         SET password_hash = ?, password_salt = ?, password_hash_scheme = ?, must_change_password = 0, updated_at = ?
         WHERE id = ?`,
      )
      .bind(hashed.hash, hashed.salt, hashed.scheme, nowIso(), row.id)
      .run()
    await audit(c.env, { actorUserId: row.id, action: 'user_password_changed', outcome: 'success' })
    return c.json(jsonOk({ changed: true }))
  })

  app.patch('/api/me/username', authMiddleware, async (c) => {
    const input = await parseJson(c, usernameSchema)
    const user = c.get('user')
    const existing = await findUserByUsername(c.env, input.username)
    if (existing && existing.id !== user.id) conflict('Username already exists')
    await c.env.DB
      .prepare('UPDATE users SET username = ?, username_normalized = ?, display_name = ?, updated_at = ? WHERE id = ?')
      .bind(input.username, input.username.toLowerCase(), input.displayName ?? null, nowIso(), user.id)
      .run()
    await audit(c.env, { actorUserId: user.id, action: 'user_username_changed', outcome: 'success' })
    const updated = await findUserById(c.env, user.id)
    return c.json(jsonOk({ user: updated ? toAuthUser(updated) : user }))
  })

  app.get('/api/admin/users', authMiddleware, async (c) => {
    assertAdmin(c.get('user'))
    const { results = [] } = await c.env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all<UserRow>()
    return c.json(jsonOk({ users: results.map(toPublicUser) }))
  })

  app.post('/api/admin/users/viewers', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const input = await parseJson(c, createViewerSchema)
    const hashed = await hashPassword(input.password)
    const row = await createUser(c.env, {
      username: input.username,
      displayName: input.displayName ?? null,
      role: 'viewer',
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      passwordScheme: hashed.scheme,
      mustChangePassword: true,
      createdBy: actor.id,
    })
    await audit(c.env, { actorUserId: actor.id, action: 'viewer_created', targetType: 'user', targetId: row.id, outcome: 'success' })
    return c.json(jsonOk({ user: toPublicUser(row) }), 201)
  })

  app.post('/api/admin/users/:userId/disable', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const target = await findUserById(c.env, requiredParam(c, 'userId'))
    if (!target) notFound('User not found')
    if (target.id === actor.id) forbidden('You cannot disable your own account')
    await assertMutableAdminTarget(c.env, target)
    await c.env.DB.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').bind('disabled', nowIso(), target.id).run()
    await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(nowIso(), target.id).run()
    await audit(c.env, { actorUserId: actor.id, action: 'user_disabled', targetType: 'user', targetId: target.id, outcome: 'success' })
    return c.json(jsonOk({ disabled: true }))
  })

  app.post('/api/admin/users/:userId/enable', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const target = await findUserById(c.env, requiredParam(c, 'userId'))
    if (!target) notFound('User not found')
    if (target.status === 'active') return c.json(jsonOk({ enabled: true, alreadyActive: true }))
    await c.env.DB.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').bind('active', nowIso(), target.id).run()
    await audit(c.env, { actorUserId: actor.id, action: 'user_enabled', targetType: 'user', targetId: target.id, outcome: 'success' })
    return c.json(jsonOk({ enabled: true }))
  })

  app.get('/api/admin/users/:userId/accounts', authMiddleware, async (c) => {
    assertAdmin(c.get('user'))
    const target = await findUserById(c.env, requiredParam(c, 'userId'))
    if (!target) notFound('User not found')
    const { results = [] } = await c.env.DB
      .prepare(
        `SELECT a.id, a.account_name, a.steam_id, a.status, p.can_view_code, p.can_view_status
         FROM account_permissions p
         INNER JOIN steam_accounts a ON a.id = p.account_id
         WHERE p.user_id = ?
         ORDER BY a.account_name`,
      )
      .bind(target.id)
      .all<{
        id: string
        account_name: string
        steam_id: string | null
        status: string
        can_view_code: number
        can_view_status: number
      }>()
    return c.json(jsonOk({
      accounts: results.map((row) => ({
        id: row.id,
        accountName: row.account_name,
        steamId: row.steam_id,
        status: row.status,
        canViewCode: Boolean(row.can_view_code),
        canViewStatus: Boolean(row.can_view_status),
      })),
    }))
  })

  app.delete('/api/admin/users/:userId', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const target = await findUserById(c.env, requiredParam(c, 'userId'))
    if (!target) notFound('User not found')
    if (target.role !== 'viewer') forbidden('Only viewer users can be deleted from this endpoint')
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM account_permissions WHERE user_id = ?').bind(target.id),
      c.env.DB.prepare('UPDATE account_key_grants SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(nowIso(), target.id),
      c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(nowIso(), target.id),
      c.env.DB.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').bind('disabled', nowIso(), target.id),
    ])
    await audit(c.env, { actorUserId: actor.id, action: 'viewer_deleted', targetType: 'user', targetId: target.id, outcome: 'success' })
    return c.json(jsonOk({ deleted: true, mode: 'soft-delete' }))
  })

  app.post('/api/admin/users/:userId/reset-password', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const input = await parseJson(c, resetPasswordSchema)
    const target = await findUserById(c.env, requiredParam(c, 'userId'))
    if (!target) notFound('User not found')
    if (target.role !== 'viewer') forbidden('Only viewer passwords can be reset from this endpoint')
    const hashed = await hashPassword(input.password)
    await c.env.DB
      .prepare(
        `UPDATE users
         SET password_hash = ?, password_salt = ?, password_hash_scheme = ?, must_change_password = 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(hashed.hash, hashed.salt, hashed.scheme, nowIso(), target.id)
      .run()
    await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(nowIso(), target.id).run()
    await audit(c.env, { actorUserId: actor.id, action: 'viewer_password_reset', targetType: 'user', targetId: target.id, outcome: 'success' })
    return c.json(jsonOk({ reset: true }))
  })

  app.get('/api/accounts', authMiddleware, async (c) => {
    const accounts = await listAccountsForUser(c.env, c.get('user'))
    return c.json(jsonOk({
      accounts: accounts.map((account) => ({
        id: account.id,
        accountName: account.account_name,
        steamId: account.steam_id,
        status: account.status,
        createdAt: account.created_at,
        updatedAt: account.updated_at,
      })),
    }))
  })

  app.post('/api/accounts/import-mafile', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const maFile = await parseMaFileImport(c)
    const account = parseMaFile(maFile)
    const imported = await createEncryptedAccount(c.env, account, actor)
    await audit(c.env, { actorUserId: actor.id, accountId: imported.row.id, action: 'account_mafile_imported', outcome: 'success' })
    return c.json(jsonOk({
      account: {
        id: imported.row.id,
        accountName: imported.row.account_name,
        steamId: imported.row.steam_id,
        status: imported.row.status,
      },
      warning: 'Imported maFile plaintext was encrypted before storage.',
    }), 201)
  })

  app.get('/api/accounts/:accountId', authMiddleware, async (c) => {
    const accountId = requiredParam(c, 'accountId')
    await assertAccountAccess(c, accountId, 'status')
    const account = await c.env.DB.prepare('SELECT * FROM steam_accounts WHERE id = ?').bind(accountId).first<{
      id: string
      account_name: string
      steam_id: string | null
      status: string
      created_at: string
      updated_at: string
    }>()
    if (!account) notFound('Account not found')
    return c.json(jsonOk({
      account: {
        id: account.id,
        accountName: account.account_name,
        steamId: account.steam_id,
        status: account.status,
        createdAt: account.created_at,
        updatedAt: account.updated_at,
      },
    }))
  })

  app.get('/api/accounts/:accountId/code', authMiddleware, async (c) => {
    const accountId = requiredParam(c, 'accountId')
    await assertAccountAccess(c, accountId, 'code')
    const accountKey = await loadAccountKeyForUser(c.env, c.get('user'), accountId)
    const secret = await decryptAccountSecret(c.env, accountId, accountKey)
    const time = await getSteamServerTime()
    const code = await generateSteamGuardCode(secret.shared_secret, time.unixTime)
    await audit(c.env, { actorUserId: c.get('user').id, accountId, action: 'account_code_viewed', outcome: 'success' })
    return c.json(jsonOk({
      code,
      secondsRemaining: secondsRemaining(time.unixTime),
      serverTime: time.unixTime,
      serverTimeSource: time.source,
      account: publicAccount(secret),
    }))
  })

  app.get('/api/accounts/:accountId/export-mafile', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const secret = await decryptAccountSecret(c.env, accountId, accountKey)
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'account_mafile_exported', outcome: 'success' })
    return new Response(serializeFullMaFile(secret), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${sanitizeDownloadName(secret.account_name)}"`,
        'Cache-Control': 'no-store',
      },
    })
  })

  app.post('/api/accounts/:accountId/permissions', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    const input = await parseJson(c, assignAccountSchema)
    const target = await findUserById(c.env, input.userId)
    if (!target) notFound('User not found')
    if (target.role !== 'viewer' || target.status !== 'active') forbidden('Only active viewers can be assigned accounts')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    await grantAccountToUser(c.env, {
      accountId,
      userId: target.id,
      accountKey,
      actorUserId: actor.id,
      canViewCode: input.canViewCode,
      canViewStatus: input.canViewStatus,
    })
    await audit(c.env, {
      actorUserId: actor.id,
      accountId,
      action: 'account_permission_granted',
      targetType: 'user',
      targetId: target.id,
      outcome: 'success',
    })
    return c.json(jsonOk({ granted: true }))
  })

  app.delete('/api/accounts/:accountId/permissions/:userId', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    const userId = requiredParam(c, 'userId')
    await revokeAccountFromUser(c.env, userId, accountId)
    await audit(c.env, {
      actorUserId: actor.id,
      accountId,
      action: 'account_permission_revoked',
      targetType: 'user',
      targetId: userId,
      outcome: 'success',
    })
    return c.json(jsonOk({ revoked: true }))
  })

  app.delete('/api/accounts/:accountId', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM account_permissions WHERE account_id = ?').bind(accountId),
      c.env.DB.prepare('UPDATE account_key_grants SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL').bind(nowIso(), accountId),
      c.env.DB.prepare('DELETE FROM steam_account_secrets WHERE account_id = ?').bind(accountId),
      c.env.DB.prepare('DELETE FROM steam_accounts WHERE id = ?').bind(accountId),
    ])
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'account_deleted', outcome: 'success' })
    return c.json(jsonOk({ deleted: true }))
  })

  app.get('/api/accounts/:accountId/steam-login/status', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    return c.json(jsonOk({ steamLogin: steamLoginStatus(account) }))
  })

  app.post('/api/accounts/:accountId/steam-login/check', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    try {
      await ensureMobileAccessToken(c.env, accountId, accountKey, account)
      return c.json(jsonOk({ steamLogin: steamLoginStatus(account, { checked: true }) }))
    } catch (err) {
      if (err instanceof SteamApiError && (err.result === EResult.AccessDenied || err.result === EResult.NotLoggedOn)) {
        return c.json(jsonOk({
          steamLogin: steamLoginStatus(account, {
            checked: true,
            invalidMessage: 'Stored Steam login session was rejected by Steam.',
          }),
        }))
      }
      if (err instanceof Error && err.message.includes('no stored refresh token')) {
        return c.json(jsonOk({ steamLogin: steamLoginStatus(account, { checked: true }) }))
      }
      throw err
    }
  })

  app.post('/api/accounts/:accountId/steam-login/begin', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    const input = await parseJson(c, accountSteamLoginBeginSchema)
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    if (!account.account_name) badRequest('This account has no Steam account name to log in with')
    const credential = await beginCredentialLogin({
      accountName: account.account_name,
      password: input.password,
      deviceName: input.deviceName,
    })
    const initialState: AccountSteamLoginFlowState = { ...credential, accountId }
    const { state, autoSubmittedGuardCode } = await submitStoredDeviceCodeIfAllowed(initialState, account.shared_secret)
    const flow = await createEncryptedFlow(c.env, {
      kind: 'account_steam_login',
      actor,
      accountId,
      state: state as unknown as Record<string, unknown>,
    })
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'steam_login_started', outcome: 'success', targetType: 'auth_flow', targetId: flow.id })
    return c.json(jsonOk({
      flowId: flow.id,
      step: state.step,
      allowedConfirmations: state.allowedConfirmations,
      interval: state.interval,
      autoSubmittedGuardCode,
    }), 201)
  })

  app.post('/api/accounts/:accountId/steam-login/:flowId/submit-code', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    const flowId = requiredParam(c, 'flowId')
    const input = await parseJson(c, guardCodeSchema)
    const { row, state } = await loadEncryptedFlow<AccountSteamLoginFlowState>(c.env, flowId, actor, 'account_steam_login')
    assertFlowAccount(row.account_id, accountId)
    const next = await submitCredentialGuardCode(state, input) as AccountSteamLoginFlowState
    await updateEncryptedFlow(c.env, flowId, next as unknown as Record<string, unknown>, 'pending')
    return c.json(jsonOk({ flowId, step: next.step }))
  })

  app.post('/api/accounts/:accountId/steam-login/:flowId/poll', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    const flowId = requiredParam(c, 'flowId')
    const { row, state } = await loadEncryptedFlow<AccountSteamLoginFlowState>(c.env, flowId, actor, 'account_steam_login')
    assertFlowAccount(row.account_id, accountId)
    const next = await pollCredentialTokens(state) as AccountSteamLoginFlowState
    if (next.step !== 'tokens_ready') {
      await updateEncryptedFlow(c.env, flowId, next as unknown as Record<string, unknown>, 'pending')
      return c.json(jsonOk({ flowId, step: next.step }))
    }
    if (!next.tokens?.access_token || !next.tokens.refresh_token) {
      throw new Error('Steam auth completed without persisted tokens')
    }
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    const existingSteamId = String(account.steam_id || '')
    const steamIdChanged = Boolean(existingSteamId && existingSteamId !== next.steamId)
    account.steam_id = next.steamId
    account.tokens = next.tokens
    await saveAccountSecret(c.env, accountId, accountKey, account)
    await c.env.DB
      .prepare('UPDATE steam_accounts SET steam_id = ?, updated_at = ? WHERE id = ?')
      .bind(next.steamId, nowIso(), accountId)
      .run()
    await updateEncryptedFlow(c.env, flowId, next as unknown as Record<string, unknown>, 'completed')
    await audit(c.env, {
      actorUserId: actor.id,
      accountId,
      action: 'steam_login_completed',
      outcome: 'success',
      targetType: 'auth_flow',
      targetId: flowId,
      metadata: steamIdChanged ? { steamIdUpdated: true } : null,
    })
    return c.json(jsonOk({
      flowId,
      step: next.step,
      steamLogin: steamLoginStatus(account, { checked: true }),
      steamIdChanged,
    }))
  })

  app.post('/api/accounts/:accountId/authenticator/remove', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const input = await parseJson(c, removeAuthenticatorSchema)
    const accountId = requiredParam(c, 'accountId')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    const accessToken = await ensureMobileAccessToken(c.env, accountId, accountKey, account)
    const revocationCode = input.revocationCode || account.revocation_code
    if (!revocationCode) badRequest('revocationCode is required because this account has no stored revocation code')
    const response = await removeAuthenticator({
      revocationCode,
      removeAllSteamguardCookies: true,
    }, accessToken)
    if (!response.response.success) {
      badRequest(`Steam did not remove authenticator; attempts remaining: ${response.response.revocationAttemptsRemaining ?? 'unknown'}`)
    }
    await c.env.DB.prepare('UPDATE steam_accounts SET status = ?, updated_at = ? WHERE id = ?').bind('authenticator_removed', nowIso(), accountId).run()
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'authenticator_removed', outcome: 'success' })
    return c.json(jsonOk({ removed: true }))
  })

  app.get('/api/admin/audit', authMiddleware, async (c) => {
    assertAdmin(c.get('user'))
    const { results = [] } = await c.env.DB
      .prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 200')
      .all<Record<string, unknown>>()
    return c.json(jsonOk({ events: results }))
  })

  app.post('/api/authenticator/setup/begin', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const input = await parseJson(c, credentialFlowSchema)
    const credential = await beginCredentialLogin(input)
    const state = newSetupFlowState(credential)
    const flow = await createEncryptedFlow(c.env, {
      kind: 'authenticator_setup',
      actor,
      state: state as unknown as Record<string, unknown>,
    })
    await audit(c.env, { actorUserId: actor.id, action: 'authenticator_setup_started', outcome: 'success', targetType: 'auth_flow', targetId: flow.id })
    return c.json(jsonOk({
      flowId: flow.id,
      step: state.step,
      allowedConfirmations: state.allowedConfirmations,
      interval: state.interval,
    }), 201)
  })

  app.post('/api/authenticator/setup/:flowId/submit-code', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const flowId = requiredParam(c, 'flowId')
    const input = await parseJson(c, guardCodeSchema)
    const { state } = await loadEncryptedFlow<SetupFlowState>(c.env, flowId, actor, 'authenticator_setup')
    const next = await submitCredentialGuardCode(state, input) as SetupFlowState
    await updateEncryptedFlow(c.env, flowId, next as unknown as Record<string, unknown>, 'pending')
    return c.json(jsonOk({ flowId, step: next.step }))
  })

  app.post('/api/authenticator/setup/:flowId/poll', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const flowId = requiredParam(c, 'flowId')
    const { state } = await loadEncryptedFlow<SetupFlowState>(c.env, flowId, actor, 'authenticator_setup')
    const credential = await pollCredentialTokens(state)
    let next = { ...state, ...credential } as SetupFlowState
    if (credential.step === 'tokens_ready') next = await addAuthenticatorForSetup(next)
    await updateEncryptedFlow(c.env, flowId, next as unknown as Record<string, unknown>, next.provisionalAccount ? 'await_activation' : 'pending')
    return c.json(jsonOk({
      flowId,
      step: next.provisionalAccount ? 'await_activation' : next.step,
      allowedConfirmations: next.allowedConfirmations,
      phoneNumberHint: next.phoneNumberHint,
      confirmType: next.confirmType,
      revocationCode: next.provisionalAccount?.revocation_code,
    }))
  })

  app.post('/api/authenticator/setup/:flowId/complete', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const flowId = requiredParam(c, 'flowId')
    const input = await parseJson(c, activationCodeSchema)
    const { state } = await loadEncryptedFlow<SetupFlowState>(c.env, flowId, actor, 'authenticator_setup')
    const result = await finalizeSetupAuthenticator(state, input.activationCode)
    await updateEncryptedFlow(c.env, flowId, result.state as unknown as Record<string, unknown>, result.finalized ? 'completed' : 'await_activation')
    if (!result.finalized) return c.json(jsonOk({ flowId, step: 'await_activation', wantMore: result.wantMore }))
    if (!result.state.provisionalAccount) throw new Error('Setup flow finalized without provisional account')
    const imported = await createEncryptedAccount(c.env, result.state.provisionalAccount, actor)
    await audit(c.env, { actorUserId: actor.id, accountId: imported.row.id, action: 'authenticator_setup_completed', outcome: 'success', targetType: 'auth_flow', targetId: flowId })
    return c.json(jsonOk({
      flowId,
      account: {
        id: imported.row.id,
        accountName: imported.row.account_name,
        steamId: imported.row.steam_id,
        status: imported.row.status,
      },
    }))
  })

  app.post('/api/authenticator/transfer/begin', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const input = await parseJson(c, credentialFlowSchema)
    const credential = await beginCredentialLogin(input)
    const state = newTransferFlowState(credential)
    const flow = await createEncryptedFlow(c.env, {
      kind: 'authenticator_transfer',
      actor,
      state: state as unknown as Record<string, unknown>,
    })
    await audit(c.env, { actorUserId: actor.id, action: 'authenticator_transfer_started', outcome: 'success', targetType: 'auth_flow', targetId: flow.id })
    return c.json(jsonOk({
      flowId: flow.id,
      step: state.step,
      allowedConfirmations: state.allowedConfirmations,
      interval: state.interval,
    }), 201)
  })

  app.post('/api/authenticator/transfer/:flowId/submit-code', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const flowId = requiredParam(c, 'flowId')
    const input = await parseJson(c, guardCodeSchema)
    const { state } = await loadEncryptedFlow<TransferFlowState>(c.env, flowId, actor, 'authenticator_transfer')
    const next = await submitCredentialGuardCode(state, input) as TransferFlowState
    await updateEncryptedFlow(c.env, flowId, next as unknown as Record<string, unknown>, 'pending')
    return c.json(jsonOk({ flowId, step: next.step }))
  })

  app.post('/api/authenticator/transfer/:flowId/poll', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const flowId = requiredParam(c, 'flowId')
    const { state } = await loadEncryptedFlow<TransferFlowState>(c.env, flowId, actor, 'authenticator_transfer')
    const credential = await pollCredentialTokens(state)
    let next = { ...state, ...credential } as TransferFlowState
    if (credential.step === 'tokens_ready') next = await startTransferAuthenticator(next)
    await updateEncryptedFlow(c.env, flowId, next as unknown as Record<string, unknown>, credential.step === 'tokens_ready' ? 'await_sms' : 'pending')
    return c.json(jsonOk({ flowId, step: credential.step === 'tokens_ready' ? 'await_sms' : next.step }))
  })

  app.post('/api/authenticator/transfer/:flowId/submit-sms', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const flowId = requiredParam(c, 'flowId')
    const input = await parseJson(c, smsCodeSchema)
    const { state } = await loadEncryptedFlow<TransferFlowState>(c.env, flowId, actor, 'authenticator_transfer')
    const account = await finishTransferAuthenticator(state, input.smsCode)
    const imported = await createEncryptedAccount(c.env, account, actor)
    await updateEncryptedFlow(c.env, flowId, state as unknown as Record<string, unknown>, 'completed')
    await audit(c.env, { actorUserId: actor.id, accountId: imported.row.id, action: 'authenticator_transfer_completed', outcome: 'success', targetType: 'auth_flow', targetId: flowId })
    return c.json(jsonOk({
      flowId,
      account: {
        id: imported.row.id,
        accountName: imported.row.account_name,
        steamId: imported.row.steam_id,
        status: imported.row.status,
      },
      revocationCode: account.revocation_code,
    }))
  })

  app.get('/api/accounts/:accountId/confirmations', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    let confirmations
    try {
      confirmations = await listConfirmations(c.env, accountId, accountKey, account)
    } catch (err) {
      translateSteamSessionError(err)
    }
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'confirmations_listed', outcome: 'success' })
    return c.json(jsonOk({ confirmations }))
  })

  app.get('/api/accounts/:accountId/confirmations/:confirmationId/details', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const accountId = requiredParam(c, 'accountId')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    let html
    try {
      html = await getConfirmationDetails(c.env, accountId, accountKey, account, requiredParam(c, 'confirmationId'))
    } catch (err) {
      translateSteamSessionError(err)
    }
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'confirmation_details_viewed', outcome: 'success' })
    return c.json(jsonOk({ html }))
  })

  app.post('/api/accounts/:accountId/confirmations/:confirmationId/accept', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const input = await parseJson(c, confirmationActionSchema)
    const accountId = requiredParam(c, 'accountId')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    try {
      await actOnConfirmation(c.env, accountId, accountKey, account, 'allow', { id: requiredParam(c, 'confirmationId'), nonce: input.nonce })
    } catch (err) {
      translateSteamSessionError(err)
    }
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'confirmation_accepted', outcome: 'success' })
    return c.json(jsonOk({ accepted: true }))
  })

  app.post('/api/accounts/:accountId/confirmations/:confirmationId/deny', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const input = await parseJson(c, confirmationActionSchema)
    const accountId = requiredParam(c, 'accountId')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    try {
      await actOnConfirmation(c.env, accountId, accountKey, account, 'cancel', { id: requiredParam(c, 'confirmationId'), nonce: input.nonce })
    } catch (err) {
      translateSteamSessionError(err)
    }
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'confirmation_denied', outcome: 'success' })
    return c.json(jsonOk({ denied: true }))
  })

  app.post('/api/accounts/:accountId/confirmations/bulk', authMiddleware, async (c) => {
    const actor = c.get('user')
    assertAdmin(actor)
    const input = await parseJson(c, bulkConfirmationSchema)
    const accountId = requiredParam(c, 'accountId')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    try {
      await actOnConfirmationsBulk(c.env, accountId, accountKey, account, input.action, input.confirmations)
    } catch (err) {
      translateSteamSessionError(err)
    }
    await audit(c.env, { actorUserId: actor.id, accountId, action: input.action === 'allow' ? 'confirmations_bulk_accepted' : 'confirmations_bulk_denied', outcome: 'success', metadata: { count: input.confirmations.length } })
    return c.json(jsonOk({ completed: true, count: input.confirmations.length }))
  })

  app.get('/api/accounts/:accountId/login-sessions', authMiddleware, async (c) => {
    const actor = c.get('user')
    const accountId = requiredParam(c, 'accountId')
    await assertAccountAccess(c, accountId, 'code')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    let sessions
    try {
      sessions = await listLoginSessions(c.env, accountId, accountKey, account)
    } catch (err) {
      translateSteamSessionError(err)
    }
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'login_sessions_listed', outcome: 'success' })
    return c.json(jsonOk({ sessions }))
  })

  app.post('/api/accounts/:accountId/login-sessions/challenge-info', authMiddleware, async (c) => {
    const actor = c.get('user')
    const input = await parseJson(c, challengeInfoSchema)
    const accountId = requiredParam(c, 'accountId')
    await assertAccountAccess(c, accountId, 'code')
    const challenge = input.challengeUrl
      ? parseSteamQrChallenge(input.challengeUrl)
      : { version: Number(input.version || 1), clientId: String(input.clientId || '') }
    if (!challenge.clientId) badRequest('clientId or challengeUrl is required')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    try {
      const info = await getChallengeSessionInfo(c.env, accountId, accountKey, account, challenge)
      return c.json(jsonOk({ session: info }))
    } catch (err) {
      translateLoginApprovalError(err)
    }
  })

  app.post('/api/accounts/:accountId/login-sessions/approve', authMiddleware, async (c) => {
    const actor = c.get('user')
    const input = await parseJson(c, loginApprovalSchema)
    const accountId = requiredParam(c, 'accountId')
    await assertAccountAccess(c, accountId, 'code')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    try {
      await approveLoginChallenge(c.env, accountId, accountKey, account, { ...input, confirm: true })
    } catch (err) {
      translateLoginApprovalError(err)
    }
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'login_session_approved', outcome: 'success' })
    return c.json(jsonOk({ approved: true }))
  })

  app.post('/api/accounts/:accountId/login-sessions/deny', authMiddleware, async (c) => {
    const actor = c.get('user')
    const input = await parseJson(c, loginApprovalSchema)
    const accountId = requiredParam(c, 'accountId')
    await assertAccountAccess(c, accountId, 'code')
    const accountKey = await loadAccountKeyForUser(c.env, actor, accountId)
    const account = await decryptAccountSecret(c.env, accountId, accountKey)
    try {
      await approveLoginChallenge(c.env, accountId, accountKey, account, { ...input, confirm: false })
    } catch (err) {
      translateLoginApprovalError(err)
    }
    await audit(c.env, { actorUserId: actor.id, accountId, action: 'login_session_denied', outcome: 'success' })
    return c.json(jsonOk({ denied: true }))
  })

  app.notFound(async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ ok: false, error: { code: 'not_found', message: 'API route not found' } }, 404)
    }
    const cookie = getCookie(c, 'sg_session')
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw)
    return c.html(`<!doctype html><p>SteamGuard Web${cookie ? '' : ''}</p>`)
  })

  return app
}
