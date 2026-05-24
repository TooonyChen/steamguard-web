import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourceDir = join(root, 'steamguard-cli/steamguard-cli/steamguard/protobufs')
const outDir = join(root, 'src/generated')
const outJs = join(outDir, 'steam-protobuf.js')
const outDts = join(outDir, 'steam-protobuf.d.ts')
const pbjs = join(root, 'node_modules/.bin/pbjs')
const pbts = join(root, 'node_modules/.bin/pbts')

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

if (!existsSync(sourceDir)) {
  throw new Error(`Missing upstream protobuf directory: ${sourceDir}`)
}

mkdirSync(outDir, { recursive: true })

const tempDir = mkdtempSync(join(tmpdir(), 'steamguard-web-protobufs-'))
try {
  cpSync(sourceDir, tempDir, { recursive: true })

  // protobufjs rejects the upstream tree because both common_base.proto and
  // steammessages_unified_base.steamclient.proto declare a package-less
  // NoResponse message. The common_base variant is not referenced by the V1
  // SteamGuard API messages, so we rename it only in this temporary copy.
  const commonBase = join(tempDir, 'common_base.proto')
  const patched = readFileSync(commonBase, 'utf8').replace('message NoResponse {', 'message CSGWCommonNoResponse {')
  writeFileSync(commonBase, patched)

  const entries = [
    'custom.proto',
    'service_twofactor.proto',
    'service_phone.proto',
    'steammessages_auth.steamclient.proto',
    'steammessages_clientserver_login.proto',
  ].map((file) => join(tempDir, file))

  run(pbjs, ['-t', 'static-module', '-w', 'es6', '-o', outJs, ...entries])
  run(pbts, ['-o', outDts, outJs])
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

