# Vendure Product Launch Scheduler

Schedule products to be **enabled or disabled at a future time**: launch a product at 09:00 Berlin time, take it offline for a weekend, or run a flash sale window that restores the previous state afterwards.

- Plans changes in the administrator's **time zone**, with correct handling of daylight saving time.
- Each schedule has a **start** and an optional **end** (disable, enable, or *restore* what was there before).
- **Conflict checks:** a product can't have overlapping schedules.
- **Reliable execution:** atomic claims (safe with several workers), retries with backoff, recovery from crashed workers, and a full execution history.
- **Dashboard:** a panel on the product page and a *Catalog → Launch schedules* list.
- **Admin API**, permission-checked, with typed validation errors.

Tested on Vendure **3.6.1** and **3.8.0**, with SQLite and PostgreSQL.

> **Global, not per channel.** A schedule changes the product's own `enabled` setting, which applies to **every channel**. The dashboard asks the administrator to confirm this when creating a schedule.

## Requirements

- Vendure `^3.6.0`
- A scheduler strategy, normally Vendure's `DefaultSchedulerPlugin`. Due schedules are processed by a Vendure [scheduled task](https://docs.vendure.io/guides/developer-guide/scheduled-tasks/), which runs on the **worker**. Without a scheduler strategy nothing runs: the plugin logs an error at startup and the dashboard shows a warning.

## Installation

```bash
npm install @rahul_vendure/vendure-plugin-product-launch-scheduler
```

```ts
import { DefaultSchedulerPlugin, VendureConfig } from '@vendure/core';
import { ProductLaunchSchedulerPlugin } from '@rahul_vendure/vendure-plugin-product-launch-scheduler';

export const config: VendureConfig = {
    // ...
    plugins: [
        DefaultSchedulerPlugin.init(),
        ProductLaunchSchedulerPlugin.init({
            // all optional, see Options
        }),
    ],
};
```

### Database

The plugin adds two tables, `product_launch_schedule` and `product_launch_schedule_execution`. Either:

- generate a migration as usual: `npx vendure migrate --generate add-launch-schedules`, **or**
- use the migration the plugin ships:

```ts
import { ProductLaunchSchedulerMigration1792800000000 } from '@rahul_vendure/vendure-plugin-product-launch-scheduler';

dbConnectionOptions: {
    migrations: [ProductLaunchSchedulerMigration1792800000000, path.join(__dirname, 'migrations/*.+(js|ts)')],
},
```

Use one or the other, not both. The shipped migration builds the tables from the entity metadata, so it works on PostgreSQL, MySQL/MariaDB and SQLite, and follows your ID strategy and `entityPrefix`.

### Dashboard

Nothing to configure: the Vendure dashboard's Vite plugin picks up the plugin's dashboard extension from your Vendure config. Rebuild the dashboard after installing.

## Using it

### In the dashboard

On a product's page, the **Launch schedule** panel shows:

- the product's current global state and its upcoming, active and failed schedules, in local time and UTC.
- **Schedule a change**, which opens a form:
  - **At the start:** Enable or Disable.
  - **Start** date and time, and the **time zone** (defaults to the browser's). The UTC equivalent is shown live. A time that doesn't exist because of a daylight-saving change is flagged, with a one-click fix.
  - Optionally, **End at a later time**, with what happens at the end:
    - *Restore* puts back the state from before the start.
    - *Disable* or *Enable* sets it explicitly.
  - An optional name, and a confirmation that the change applies to every channel.
- **Edit**, **Cancel** and **Retry** buttons on each schedule.

**Catalog → Launch schedules** lists all schedules of products in the active channel. You can filter by status, date range and product, page through them, and expand a row to see each step that ran: when, the outcome, and the enabled state before and after.

### In the Admin API

```graphql
mutation {
  createProductLaunchSchedule(input: {
    productId: "42"
    action: ENABLE
    scheduledAt: "2026-11-27T09:00"     # local time…
    timezone: "Europe/Berlin"            # …in this zone
    endAt: "2026-11-30T23:59"
    endAction: RESTORE
    name: "Black Friday"
  }) {
    id status scheduledAt endAt nextRunAt   # UTC instants
  }
}
```

| | |
|---|---|
| **Queries** | `productLaunchSchedules(options)` (filters: `productId`, `status`, `from`, `to`; `skip`/`take`; sorted by `scheduledAt`, `nextRunAt`, `createdAt` or `updatedAt`) · `productLaunchSchedule(id)` · `productLaunchScheduleExecutions(scheduleId)` · `productLaunchSchedulerStatus` · `productLaunchTimePreview(localTime, timezone)` |
| **Mutations** | `createProductLaunchSchedule` · `updateProductLaunchSchedule` · `cancelProductLaunchSchedule(id)` · `retryProductLaunchSchedule(id)` |
| **Permissions** | Queries: `ReadCatalog` or `ReadProduct`. Mutations: `UpdateCatalog` or `UpdateProduct`. Only products in the **active channel** can be scheduled or seen. |

Times are entered as local date-times (`YYYY-MM-DDTHH:mm`) plus an IANA time zone, and stored as UTC instants together with what was entered.

#### Errors

Validation errors carry a code in `extensions.code`:

| Code | When |
|---|---|
| `INVALID_TIMEZONE` | Not an IANA time zone. |
| `INVALID_LOCAL_TIME` | The time doesn't exist in that zone (skipped by a daylight-saving change). The message names the next valid time. |
| `INVALID_INPUT` | Malformed date-time, or `endAction` without `endAt`. |
| `SCHEDULE_IN_PAST` | The start (or new end) is more than a minute in the past. |
| `END_BEFORE_START` | The end isn't after the start. |
| `SCHEDULE_CONFLICT` | It overlaps another unfinished schedule of the same product. The message names that schedule. |
| `INVALID_STATUS_TRANSITION` | E.g. editing a completed schedule, or cancelling one that is running. |
| `PRODUCT_NOT_FOUND` | No such product in the active channel. |

## How it works

### Lifecycle

```
PENDING ──start──► ACTIVE ──end──► COMPLETED        (with an end)
PENDING ──start──► COMPLETED                         (without an end)
   │                 │
   ├─ cancel ────────┴──► CANCELLED
   └─ step fails maxAttempts times ──► FAILED ──retry──► PENDING / ACTIVE
```

`PROCESSING` is shown while a worker runs a step.

| Status | Can edit | Can cancel |
|---|---|---|
| PENDING | everything | yes |
| ACTIVE (started) | the end only | yes, and the end step won't run; the product stays as it is |
| FAILED | – | – (retry instead) |

### Execution

A single scheduled task, `product-launch-scheduler:process-due`, runs every minute by default (`pollSchedule`). Each run:

1. **Releases** schedules whose worker disappeared mid-step (lease expired).
2. **Finds** due schedules (`nextRunAt <= now`, up to `batchSize`).
3. **Claims** each with one conditional `UPDATE`. Exactly one worker wins, even with several workers or a scheduler that doesn't lock tasks.
4. **Runs** the step in a transaction: it sets `Product.enabled` through Vendure's `ProductService`, so the usual events fire and search indexes update. It then records an execution and moves the schedule on.

A step *sets a value* (`enabled = true/false`), so running it twice is harmless; a repeat is recorded as `NO_CHANGE`.

- **Latency:** a step runs at most one `pollSchedule` interval after its time, plus however long the worker is busy.
- **Failures:** a failing step is retried after 1, 5, then 15 minutes. After `maxAttempts` it's `FAILED` and can be retried from the dashboard or API.
- **Downtime:** steps missed while the worker was down run when it's back, and the delay is recorded. To skip them instead, set `skipIfLateBy`.

### Rules

- **No overlaps:** each unfinished schedule occupies `[start, end]` (or just its start instant). Overlapping or touching schedules for the same product are rejected; sequential ones are fine.
- **Restore is careful:** *Restore* only applies if the product still has the state the start step set. If someone changed it by hand in between, nothing is changed and the step is recorded as `SKIPPED`. *Enable* and *Disable* end actions always apply.
- **Time zones:** times are converted with `Intl`, never the server's zone.
  - A time skipped by a daylight-saving change (e.g. 02:30 on spring-forward night) is rejected.
  - A time that happens twice (fall-back night) uses the earlier occurrence.
- **Deleted products:** deleting a product cancels its unfinished schedules.

## Options

```ts
ProductLaunchSchedulerPlugin.init({
    pollSchedule: '* * * * *', // cron; 6 fields allow seconds, e.g. '*/30 * * * * *'
    batchSize: 50,             // due schedules per run
    maxAttempts: 3,            // per step, before FAILED
    leaseSeconds: 300,         // how long a worker may hold a schedule while running a step
    skipIfLateBy: undefined,   // seconds; when set, steps due longer ago are marked FAILED instead of run
})
```

## Events

`ProductLaunchScheduleEvent` is published when a schedule is `created`, `updated`, `cancelled` or `retried`, when a step runs (`executed`), and when one fails for good (`failed`). For steps, the event includes `step` and `outcome`.

```ts
eventBus.ofType(ProductLaunchScheduleEvent).subscribe(event => {
    if (event.type === 'failed') {
        // notify someone
    }
});
```

## Services

`ProductLaunchScheduleService` (create, update, cancel, retry, list) and `ProductLaunchExecutorService` (`processDue(now?)`) are exported for use in your own code, e.g. to create schedules from an import job.

## Not included

- **Per-channel scheduling.** Vendure has one `enabled` flag per product. Scheduling per channel would need per-channel availability enforced in the catalog, search, cart and checkout; see [`@rahul_vendure/vendure-plugin-channel-product-availability`](https://www.npmjs.com/package/@rahul_vendure/vendure-plugin-channel-product-availability).
- Variant-level schedules.

## Development

```bash
npm test                                   # unit + e2e (SQLite)
TEST_DB=postgres PGPORT=5432 PGPASSWORD=… npm run test:e2e
./scripts/test-against-vendure.sh 3.8.0    # the suite against another Vendure release
```

`example/` contains a small Vendure app (PostgreSQL) with the dashboard, used to check the UI and the migration.

## License

MIT
