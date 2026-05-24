export type Role = 'admin' | 'viewer'
export type UserStatus = 'active' | 'disabled'

export interface D1Result<T = unknown> {
  results?: T[]
  success: boolean
  meta: Record<string, unknown>
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(query: string): Promise<D1Result>
}

export interface Fetcher {
  fetch(request: Request): Promise<Response>
}

export type Bindings = {
  DB: D1Database
  APP_SECRET: string
  INITIAL_ADMIN_PASSWORD?: string
  ENVIRONMENT?: string
  ASSETS?: Fetcher
}

export type Variables = {
  user: AuthUser
  sessionId: string
}

export type AppEnv = {
  Bindings: Bindings
  Variables: Variables
}

export interface AuthUser {
  id: string
  username: string
  displayName: string | null
  role: Role
  status: UserStatus
  mustChangePassword: boolean
}

export interface UserRow {
  id: string
  username: string
  username_normalized: string
  display_name: string | null
  role: Role
  status: UserStatus
  password_hash: string
  password_salt: string
  password_hash_scheme: string
  must_change_password: number
  created_by: string | null
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export interface SteamAccountRow {
  id: string
  vault_id: string
  account_name: string
  steam_id: string | null
  status: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface EncryptedPayload {
  v: 1
  alg: 'AES-256-GCM'
  nonce: string
  ciphertext: string
}
