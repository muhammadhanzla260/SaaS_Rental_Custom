# Rent Hatch: working rules for Claude Code

Multi-tenant rental SaaS. Events rental is live. Car rental is being built from the task files in
`docs/car-rental/build/`. Read `docs/car-rental/build/README.md` before starting any task.

## Commands

```bash
pnpm install
pnpm db:start            # local PostgreSQL 17 on port 54329; leave it running
pnpm db:migrate          # apply migrations as the owner role
pnpm dev                 # web app on http://localhost:3000
pnpm worker              # background jobs
pnpm typecheck
pnpm test                # unit + database tests (needs db:start)
pnpm --filter @rental/db generate      # create a migration from schema changes
pnpm --filter @rental/web build
```

Run one package's tests with `pnpm --filter <package> test`. Browser checks are scripts in
`apps/web/scripts/e2e-*.mjs`; they need a built and started web app.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js 16 staff app, public quote page, coach portal, platform console |
| `apps/worker` | graphile-worker jobs |
| `apps/site` | Astro marketing site |
| `packages/core` | Pure TypeScript domain rules for events (pricing, settings, permissions). No I/O |
| `packages/db` | Drizzle schema, SQL migrations, event services, RLS |
| `packages/messaging`, `packages/payments` | Sending and Stripe flows |
| `packages/kernel` | (new) Money, time, contract helpers, rule evaluator. No I/O |
| `packages/platform` | (new) Shared contexts, one folder each: settings, outbox, approvals, billing, risk… |
| `packages/cars` | (new) Car rental contexts, one folder each: fleet, rates, reservations… |

Each new context folder has `contract/` (the only public surface), `domain/` (pure), `app/`
(handlers), `infra/` (tables, SQL), and `tests/`.

## Rules that must never be broken

1. **Tenant isolation.** Every tenant table has `tenant_id`, a composite key `(tenant_id, id)`,
   composite foreign keys, and row-level security enabled in the same migration
   (`SELECT app_enable_tenant_rls('<table>')`). All queries run inside `withTenant()`.
2. **Events must keep working.** `pnpm test` and `pnpm --filter @rental/core parity` (when the Odoo
   env file is present) stay green. Do not change event pricing results.
3. **Money** is integer minor units plus a currency. In new code use `Money` from
   `@rental/kernel`. Never write `/ 100`, `* 100` or `toFixed(2)` on money outside the kernel.
4. **Boundaries.** Code outside a context imports only its `contract/`. `packages/cars` never
   imports event code. Platform code never branches on the vertical.
5. **Pure domain.** Files in `domain/` and in `packages/core` and `packages/kernel` do no I/O and
   import no database or network code.
6. **Migrations** are additive first: add, backfill in batches, switch, then remove in a later
   migration. Set `lock_timeout` in any migration that alters a large table. Never edit an applied
   migration.
7. **Secrets** never go in code, logs, tests or commits. Card data never touches the server. ID
   documents are never accepted through chat.
8. **Configurable, not hard-coded.** A value a business could want different goes through the
   settings registry or the rules engine.
9. **One mutation path.** Writes go through a command handler that checks permission and
   `assertWritable`, writes audit, and emits an outbox event in the same transaction.

## How to work on a task

1. Open the task in `docs/car-rental/build/<phase>.md`. Check its "Depends on" and "Blocked by".
2. Work on the phase branch named in the build README. Keep one task per commit or small PR.
3. Write the tests named in "Done when" first where practical.
4. Run the task's "Verify" commands, then `pnpm typecheck` and `pnpm test`.
5. Tick the task's checkbox in the phase file in the same commit.
6. If the task turns out to be wrong or blocked, stop and write what you found under the task. Do
   not work around a rule above.

## Style

- TypeScript strict. No `any` without a comment saying why.
- Small files with one job. Comments say why, not what.
- User-facing text is plain and short. Errors shown to users never include internals.
- Zod schemas validate every input at the edge of a command.
