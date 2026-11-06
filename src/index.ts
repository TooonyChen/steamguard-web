import { createApp } from './http/app'
import { runCleanup } from './maintenance/cleanup'
import { refreshStaleAvatars } from './db/avatars'
import type { Bindings } from './types'

const app = createApp()

export default {
  fetch: app.fetch,
  async scheduled(_controller: unknown, env: Bindings, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(
      runCleanup(env).then(
        (summary) => console.log('cleanup completed', JSON.stringify(summary)),
        (error) => console.error('cleanup failed', error),
      ),
    )
    ctx.waitUntil(
      refreshStaleAvatars(env).then(
        (summary) => console.log('avatar refresh completed', JSON.stringify(summary)),
        (error) => console.error('avatar refresh failed', error),
      ),
    )
  },
}
