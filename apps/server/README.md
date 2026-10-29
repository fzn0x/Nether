# @nether/server

The Nether server: the API and the Yjs sync server (Hocuspocus) in one Node
service on [Fastify](https://fastify.dev), backed by PostgreSQL, Redis or
Valkey, and local or S3-compatible file storage. Clients talk to it only to
sync and share. See [ADR 0005](../../docs/adr/0005-server-on-fastify.md).

So far it answers `GET /health` and holds the extension point through which
the free [enterprise features](../../enterprise/) plug in. Sync,
sharing and the rest arrive in Phase 3.

## Run it

```sh
pnpm --filter @nether/server build
pnpm --filter @nether/server start      # node dist/main.js
curl http://127.0.0.1:3000/health
```

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `NETHER_HOST` | `127.0.0.1` | The address to listen on; the Docker image will set `0.0.0.0` |
| `NETHER_PORT` | `3000` | The port; `0` picks a free one |
| `NETHER_LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `NETHER_ENTERPRISE_SSO` | `off` | Single sign-on |
| `NETHER_ENTERPRISE_SCIM` | `off` | Provisioning through SCIM and LDAP |
| `NETHER_ENTERPRISE_AUDIT` | `off` | Audit logs |
| `NETHER_ENTERPRISE_POLICIES` | `off` | Data policies and advanced permissions |
| `NETHER_ENTERPRISE_ADMIN` | `off` | The admin console |
| `NETHER_ENTERPRISE_HA` | `off` | High availability |

A switch takes `on` or `off` (or `true`, `false`, `yes`, `no`, `1`, `0`). A
feature switched on in a build without its module stops the server at
startup with a message that names the variable.

## Tests

```sh
pnpm --filter @nether/server test     # Vitest, through Fastify's inject
pnpm --filter @nether/server smoke    # starts dist/main.js with every enterprise feature off
```
