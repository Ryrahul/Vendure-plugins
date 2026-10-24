# Product Launch Scheduler — architecture

Status: **implemented in 1.0.0** (this was the Phase 1 plan; differences are listed at the end). Verified against the Vendure source at v3.8.1 (`packages/core/src/scheduler`, `plugin/default-scheduler-plugin`, `event-bus`, `service/services/product.service.ts`) and the React dashboard extension API.

## 1. What Vendure provides (verified)

| Need | Vendure mechanism | Notes |
|---|---|---|
| Run code periodically | `ScheduledTask` (`@vendure/core`, since 3.3) registered in `schedulerOptions.tasks` | Cron via `croner`; a 6-field pattern allows seconds. **Only recurring schedules**: there is no API for one-off runs at arbitrary times |
| Run it reliably across processes | `DefaultSchedulerPlugin` | Tasks run on the **worker** only (`runTasksInWorkerOnly`, default). Each task is locked per run with `SELECT … FOR UPDATE` on `scheduled_task_record`, so one worker runs it at a time. Stale locks are cleared. Without a scheduler strategy, Vendure logs a warning and **runs nothing** |
| Per-task timezone | `ScheduledTaskConfig.timezone` | Only since 3.8.0, so not used. Our timestamps are UTC, and the cron only polls |
| Change `Product.enabled` | `ProductService.update(ctx, { id, enabled })` | Loads the product in `ctx.channelId` (every product is in the default channel). Publishes `ProductEvent('updated')`, which triggers the search re-index. `enabled` is **global**: one value for all channels |
| Events | `EventBus.publish(new MyEvent(ctx, …))` | Subscribers (`ofType`) run after the publishing transaction commits |
| Transactions | `TransactionalConnection.withTransaction(ctx, fn)` | Rolls back on throw |
| Admin API | `adminApiExtensions` (schema + resolvers), `@Allow(Permission…)` | |
| Dashboard | `defineDashboardExtension`: `routes` (+ `navMenuItem`), `pageBlocks` on `product-detail` | Same pattern as `vendure-plugin-channel-product-availability` |

## 2. Model

**One schedule = up to two transitions on one product**: a start action at `scheduledAt`, and optionally an end action at `endAt`.

`ProductLaunchSchedule`

| Field | Type | |
|---|---|---|
| id | PK | |
| product / productId | FK → product, `ON DELETE CASCADE` | Hard delete removes schedules; soft delete is handled in code (§5) |
| name, description | text, nullable | |
| action | `enable` \| `disable` | start action |
| scheduledAt | timestamp (UTC) | start instant |
| endAt | timestamp (UTC), nullable | must be after `scheduledAt` |
| endAction | `disable` \| `enable` \| `restore`, nullable | default `disable` when `endAt` is set |
| timezone | IANA id | the administrator's zone, used for input and display |
| localScheduledAt / localEndAt | `YYYY-MM-DDTHH:mm` | what the administrator typed (display and audit) |
| status | enum (§3) | |
| nextStep | `start` \| `end` \| null | |
| nextRunAt | timestamp (UTC), nullable | next due instant; **indexed with status** |
| attempts | int | attempts of the current step |
| leaseExpiresAt | timestamp, nullable | processing claim (§4) |
| startEnabledBefore / startEnabledAfter | bool, nullable | product state around the start step (for `restore`, §6) |
| lastExecutedAt, lastError | | |
| createdByAdministratorId | int, nullable | audit |
| createdAt, updatedAt | | |

Indexes: `(status, nextRunAt)` for the due query; `(productId, status)` for conflicts and product views.

`ProductLaunchScheduleExecution` (history, append-only): schedule FK (cascade), step, action, outcome (`succeeded` \| `no-change` \| `skipped` \| `failed`), enabledBefore, enabledAfter, attempt, message, ranLateBySeconds, executedAt.

## 3. Lifecycle

```
            create                     start ok, has end
  ┌────────────────► PENDING ──claim──► PROCESSING ──────────► ACTIVE ──claim──► PROCESSING ──► COMPLETED
  │                    │  ▲                  │ start ok, no end ─────────────────────────────────▲
  │            cancel  │  │ transient error, │                                                   │
  │                    ▼  │ attempts < max   │ attempts = max or permanent error                 │
  │               CANCELLED ◄─┴──────────────┴────────────► FAILED ──retry──► PENDING / ACTIVE ──┘
```

- Clients can't set status. Mutations: create, update (PENDING; ACTIVE only `endAt`/`endAction`), cancel (PENDING/ACTIVE), retry (FAILED).
- `PROCESSING` exists only while a worker holds the lease.
- Cancelling an ACTIVE schedule skips its end step and leaves the product as it is.

## 4. Execution engine

One `ScheduledTask` (`product-launch-scheduler:process-due`, default every minute; configurable, e.g. every 30 s). Each run:

1. Release expired leases: `PROCESSING` with `leaseExpiresAt < now` goes back to `PENDING`/`ACTIVE` (crash recovery).
2. Select due rows: `status IN (PENDING, ACTIVE) AND nextRunAt <= now`, ordered by `nextRunAt`, limited to `batchSize` (default 50).
3. For each row, **claim** with one atomic statement:
   `UPDATE … SET status='PROCESSING', leaseExpiresAt=now+lease, attempts=attempts+1 WHERE id=:id AND status=:seenStatus AND nextRunAt=:seenRunAt`.
   Continue only if exactly 1 row changed. This is safe across workers, and also under a non-default scheduler strategy that doesn't lock tasks.
4. In a transaction: load the product (default channel, `withDeleted`). If it is deleted, cancel the schedule with reason "product deleted". Otherwise apply the step (§6) via `ProductService.update` only if the state differs (a same-state step is recorded as `no-change`). Write a history row and advance the schedule (next step, ACTIVE / COMPLETED).
5. After commit: publish `ProductLaunchScheduleEvent` (`executed`). On error: roll back the product change, record a `failed` history row, and either reschedule with backoff (`nextRunAt = now + 1, 5, 15 min`; transient) or mark `FAILED` when `attempts = maxAttempts` (default 3), then publish `failed`.

**Delivery guarantee: at-least-once attempts, effectively-once state.** A step sets a desired value (`enabled = X`), so repeating it is harmless. A crash between the product update and the status update leads to a retry after lease expiry, recorded as `no-change`. History may show the repeated attempt.

**Latency:** up to one polling interval after the due time, plus queue time. Documented.

**Missed runs** (server or worker down): executed when the worker is back, with `ranLateBySeconds` recorded. Option `skipIfLateBy` (default off) can mark them `FAILED` ("missed") instead.

**No scheduler:** at bootstrap, if no scheduler strategy is configured (the `NoopSchedulerStrategy`), log an error and expose `productLaunchSchedulerStatus { schedulerRunning }`, which the dashboard shows as a banner.

## 5. Conflict policy

Per product, among schedules that aren't finished (PENDING / PROCESSING / ACTIVE):

1. **No overlapping time ranges.** Each schedule occupies `[scheduledAt, endAt]`, or the instant `scheduledAt` without an end. Creating or editing one that overlaps another is rejected with `SCHEDULE_CONFLICT`, naming the conflicting schedule and its times. This covers "two actions at the same time", "an end action overlapping another action" and nested windows. Sequential schedules are fine (enable Monday, disable Friday as two schedules).
2. **Times must be in the future** on create and update (1-minute grace).
3. **Manual changes:** start actions and explicit end actions (`enable` / `disable`) express intent and are applied whatever the current state (`no-change` if already in that state). `restore` is only applied if the product still has the state the start step set. If someone changed it manually during the window, the end step is recorded as `skipped` ("product was changed manually; not restored") and the schedule completes. Nothing stale is ever restored.
4. **Edits after a step completed:** an ACTIVE schedule can only change `endAt` / `endAction` (to future times). The start step is never re-run by an edit.
5. **Product soft-deleted:** the `ProductEvent('deleted')` subscriber cancels its unfinished schedules. The executor also cancels if it finds the product deleted.

## 6. Steps

| Step | Applies |
|---|---|
| start `enable` / `disable` | `enabled = true / false`; stores `startEnabledBefore/After` |
| end `disable` / `enable` | `enabled = false / true` |
| end `restore` | `enabled = startEnabledBefore`, only if `enabled === startEnabledAfter` now, else `skipped` |

All of them are **global** (every channel). The API and the dashboard say so, and creating one requires acknowledging the warning in the dashboard.

## 7. Time zones

- Input: local date-time (`2026-11-02T10:00`) + IANA zone. The server converts with `Intl` only (no dependency; never the server's own zone): it finds the UTC instant whose wall time in that zone equals the input.
- **Spring-forward gap** (the local time doesn't exist): rejected with `INVALID_LOCAL_TIME`, suggesting the first valid time after it.
- **Fall-back overlap** (the time happens twice): the **earlier** occurrence. The UI shows the resulting UTC time.
- Invalid zone: `INVALID_TIMEZONE` (validated with `Intl.DateTimeFormat`).
- Stored: the UTC instant (authoritative) plus the zone and the typed local text. If tz rules change later, the UTC instant stays; the UI shows the current local rendering of it next to what was typed.

## 8. Admin API

```graphql
productLaunchSchedules(options: ProductLaunchScheduleListOptions): ProductLaunchScheduleList!   # filter: productId, status, date range; paginated, sorted
productLaunchSchedule(id: ID!): ProductLaunchSchedule
productLaunchScheduleExecutions(scheduleId: ID!, options): ProductLaunchScheduleExecutionList!
productLaunchSchedulerStatus: ProductLaunchSchedulerStatus!   # scheduler running, poll interval
createProductLaunchSchedule(input: CreateProductLaunchScheduleInput!): ProductLaunchSchedule!
updateProductLaunchSchedule(input: UpdateProductLaunchScheduleInput!): ProductLaunchSchedule!
cancelProductLaunchSchedule(id: ID!): ProductLaunchSchedule!
retryProductLaunchSchedule(id: ID!): ProductLaunchSchedule!
```

Permissions: queries need `ReadCatalog` or `ReadProduct`; mutations need `UpdateCatalog` or `UpdateProduct`. Like a manual edit in Vendure, the product must be in the administrator's **active channel**; the admin acts with their own rights at creation, the worker executes as the system. Validation errors are typed (`INVALID_TIMEZONE`, `INVALID_LOCAL_TIME`, `SCHEDULE_IN_PAST`, `END_BEFORE_START`, `SCHEDULE_CONFLICT`, `INVALID_STATUS_TRANSITION`, `PRODUCT_NOT_FOUND`).

## 9. Dashboard

- **Product detail block** (side column): the current global state; upcoming and active schedules with local and UTC times; a create/edit form (action, date, time, zone defaulting to the browser's, optional end and end action); a **global-impact warning** that must be acknowledged; cancel.
- **Catalog → Launch schedules** page: table (product, action, local time + zone, UTC time, end, status, last result or error), filters (product, status, date range), pagination, actions (edit / cancel / retry), execution history, a scheduler-not-running banner, and empty / error / no-permission states.

## 10. Events

`ProductLaunchScheduleEvent(ctx, schedule, type)`, with type `created | updated | cancelled | retried | executed | failed`, plus the step and outcome for `executed`/`failed`. Logged with schedule and product IDs; no customer data.

## 11. Options

`pollSchedule` (cron, default `'* * * * *'`), `batchSize` (50), `maxAttempts` (3), `leaseSeconds` (300), `skipIfLateBy` (off).

## 12. Out of scope for 1.0

Per-channel scheduling. Vendure core has no per-channel enabled state, and doing it properly means storing our own per-channel state and enforcing it in catalog, search, cart and checkout. That's a separate design, and this plugin won't fake it with the global flag. Variant-level scheduling is also out of scope.

## 13. Compatibility and tests

Peer `@vendure/core ^3.6.0`, needing `DefaultSchedulerPlugin` (or another scheduler strategy). Tested against 3.6.1 (monorepo) and 3.8.x; SQLite (sql.js, the default test DB) and PostgreSQL. Tests: unit (timezone conversion, DST gaps and overlaps, validation, conflicts, transitions); e2e against a real server (API, permissions, pagination; the executor with real due rows, concurrent claims with two executor instances, lease recovery, retries, permanent failure, cancellation, product deletion, manual-change policy); dashboard (typecheck and build, plus browser checks).

## 14. Implementation notes (1.0.0)

Differences from the plan above:

- The claim is guarded by an integer `revision` column instead of comparing `nextRunAt` timestamps (timestamp equality is unreliable across databases). Admin writes use the same guard, so an edit can never overwrite a schedule a worker claimed in the meantime.
- `createdByAdministratorId` became `createdByUserId` (the active user, available without an extra lookup).
- Removing the end of an ACTIVE schedule completes it.
- A `productLaunchTimePreview` query was added for the dashboard's live UTC preview and DST hints.
- Errors use `I18nError` with the codes from §8 in `extensions.code`, rather than ErrorResult unions.
