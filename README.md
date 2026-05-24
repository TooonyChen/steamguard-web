# SteamGuard Web

Multi-user web version of `steamguard-cli`, designed for Cloudflare Workers, Hono, D1, and a React static frontend.

## Docs

- [Architecture](docs/architecture.md)
- [Implementation Plan](docs/implementation-plan.md)
- [Technical Decisions](docs/decisions.md)
- [Source Porting Map](docs/source-porting-map.md)

## Development

```txt
bun install
bun run dev
```

```txt
bun run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
bun run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```
