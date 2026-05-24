import { hashPassword, nowIso, randomId, randomToken } from '../src/crypto/webcrypto'

declare const Bun: any

const args = new Set(Bun.argv.slice(2))
const databaseName = process.env.D1_DATABASE_NAME || 'steamguard-web'
const environment = process.env.ENVIRONMENT || process.env.NODE_ENV || 'development'
const useLocal = args.has('--local') || !args.has('--remote')
const allowGeneratedDevPassword = args.has('--generate-dev-password')

type D1JsonResult = Array<{
  results?: Array<Record<string, unknown>>
  success?: boolean
}>

function sqlString(value: string | null): string {
  if (value === null) return 'NULL'
  return `'${value.replaceAll("'", "''")}'`
}

async function runWrangler(command: string): Promise<D1JsonResult> {
  const modeArg = useLocal ? '--local' : '--remote'
  const proc = Bun.spawn([
    'bunx',
    'wrangler',
    'd1',
    'execute',
    databaseName,
    modeArg,
    '--json',
    '--command',
    command,
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`wrangler d1 execute failed:\n${stderr || stdout}`)
  }
  const jsonStart = stdout.search(/[\[{]/)
  const jsonText = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout
  try {
    return JSON.parse(jsonText) as D1JsonResult
  } catch {
    throw new Error(`wrangler returned non-JSON output:\n${stdout}\n${stderr}`)
  }
}

async function tableCount(table: string): Promise<number> {
  const rows = await runWrangler(`SELECT COUNT(*) AS count FROM ${table};`)
  return Number(rows[0]?.results?.[0]?.count ?? 0)
}

function initialPassword(): { password: string; generated: boolean } {
  const configured = process.env.INITIAL_ADMIN_PASSWORD
  if (configured) return { password: configured, generated: false }
  if (environment === 'production' || args.has('--remote')) {
    throw new Error('INITIAL_ADMIN_PASSWORD is required for production or remote bootstrap.')
  }
  if (!allowGeneratedDevPassword) {
    throw new Error('Set INITIAL_ADMIN_PASSWORD, or pass --generate-dev-password for explicit local development bootstrap.')
  }
  return { password: randomToken(), generated: true }
}

async function main(): Promise<void> {
  const users = await tableCount('users')
  if (users > 0) {
    console.log('admin already exists; bootstrap skipped')
    return
  }

  const { password, generated } = initialPassword()
  const hashed = await hashPassword(password)
  const now = nowIso()
  const userId = randomId('user_')
  const vaultId = randomId('vault_')

  await runWrangler(`
    INSERT INTO vaults (
      id, name, schema_version, kdf_scheme, kdf_params_json, created_at, updated_at
    ) VALUES (
      ${sqlString(vaultId)},
      'default',
      1,
      'pbkdf2-sha256',
      '{"purpose":"account-key-grants"}',
      ${sqlString(now)},
      ${sqlString(now)}
    );

    INSERT INTO users (
      id, username, username_normalized, display_name, role, status,
      password_hash, password_salt, password_hash_scheme, must_change_password,
      created_by, created_at, updated_at
    ) VALUES (
      ${sqlString(userId)},
      'admin',
      'admin',
      'Administrator',
      'admin',
      'active',
      ${sqlString(hashed.hash)},
      ${sqlString(hashed.salt)},
      ${sqlString(hashed.scheme)},
      1,
      NULL,
      ${sqlString(now)},
      ${sqlString(now)}
    );

    INSERT OR REPLACE INTO bootstrap_state (key, value, created_at)
    VALUES ('admin_created_at', ${sqlString(now)}, ${sqlString(now)});
  `)

  console.log('admin user created: username=admin')
  if (generated) {
    console.log(`development initial admin password: ${password}`)
  } else {
    console.log('initial admin password loaded from INITIAL_ADMIN_PASSWORD')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
