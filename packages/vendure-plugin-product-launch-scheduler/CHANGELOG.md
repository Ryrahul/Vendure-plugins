# Changelog

## 1.0.0

First release.

- Schedule a product's global `enabled` state: a start step (enable or disable) and an optional end step (disable, enable or restore).
- Times entered in an IANA time zone; DST gaps rejected with a suggested time, DST overlaps resolved to the earlier instant.
- Conflict checks per product, typed validation errors, status rules for edit, cancel and retry.
- Execution by one recurring scheduled task: atomic claims, retries with backoff (1, 5, 15 minutes), lease recovery, optional `skipIfLateBy`, execution history.
- Admin API with permission checks and active-channel scoping; `ProductLaunchScheduleEvent`.
- Dashboard: Launch schedule panel on the product page and a Catalog → Launch schedules page.
- Shipped migration `ProductLaunchSchedulerMigration1792800000000`.
- Tested on Vendure 3.6.1 and 3.8.0, SQLite and PostgreSQL.
