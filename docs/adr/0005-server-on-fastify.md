# 0005. Run the server on Fastify

- Status: Accepted
- Date: 2026-10-30

## Context

`apps/server` is one Node service that will hold the REST API, the Yjs
sync server ([ADR 0003](0003-sync-yjs-hocuspocus.md)), sign-in, sharing,
publishing and webhooks, backed by PostgreSQL and Redis or Valkey. The
plan named Fastify or Hono. The
[requirements](../requirements.md#non-functional-requirements) shape the
choice:

- The server must meet OWASP ASVS Level 2: validated input, rate
  limiting, security headers and a content security policy.
- Enterprise features plug in through extension points, core code never
  depends on them, and a server must run with every one of them off.
- A single 2 vCPU, 4 GB server serves 200 active users.

## Decision

The server runs on **Fastify 5**.

- **Plugins are the unit of features.** Each feature registers as a
  Fastify plugin, with its own routes, hooks and decorations kept inside
  it by Fastify's encapsulation. Enterprise features are plugins that the
  server registers only when their switch is on, through an extension
  point defined in `apps/server`; the core plugins never import them.
- **Every route declares JSON schemas** for its input and output: Fastify
  validates requests against them and serializes responses from them.
- **Security comes from Fastify's own plugins**: `@fastify/rate-limit`,
  `@fastify/helmet` for the security headers and content security policy,
  `@fastify/cookie` and `@fastify/cors`, added as the features that need
  them arrive.
- **Logs are structured JSON** from Pino, which Fastify includes.
- **Sync shares the service.** Hocuspocus's `handleConnection` takes a
  WebSocket and its request, so the server hands it the WebSocket
  upgrades on the sync path rather than running a second server.
- **Tests run without a network** through Fastify's `inject`.

## Alternatives

- **Hono.** Small and built on web-standard requests and responses, so it
  runs on edge runtimes too. Nether's server is a long-running Node
  process next to PostgreSQL and Redis, so that portability buys nothing,
  and Hono's middleware has no equivalent of Fastify's encapsulation for
  modules that may be absent.
- **Express.** The most familiar, but it validates nothing by default,
  its middleware is not encapsulated, and it is slower.
- **NestJS.** A full framework of decorators and dependency injection,
  more structure than one service needs, and it runs on Express or
  Fastify underneath anyway.
- **Hocuspocus's own server alone.** It serves sync but has no API
  framework for the rest.

## Consequences

- A feature is a plugin with schemas and `inject` tests; reviews can check
  both.
- `apps/server` defines the extension point and the switches for
  enterprise features, and CI runs the server with every one of them
  off.
- How schemas are written in TypeScript (TypeBox, or Zod through a type
  provider) is decided when the API grows, in Phase 3.
- We would revisit this if Fastify's plugin model got in the way of the
  sync server, or if a profile of the 200-user target showed the
  framework itself as a cost.
