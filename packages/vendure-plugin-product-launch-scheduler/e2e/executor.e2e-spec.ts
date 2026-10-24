import { EventBus, Product, ProductService, TransactionalConnection } from '@vendure/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    PROCESS_DUE_TASK_ID,
    ProductLaunchExecutorService,
    ProductLaunchSchedule,
    ProductLaunchScheduleEvent,
    ProductLaunchSchedulerPlugin,
} from '../src';

import {
    CANCEL_SCHEDULE,
    CREATE_SCHEDULE,
    DELETE_PRODUCT,
    GET_PRODUCT,
    GET_SCHEDULE,
    LIST_EXECUTIONS,
    RETRY_SCHEDULE,
    RUN_SCHEDULED_TASK,
    SHOP_PRODUCT,
    UPDATE_PRODUCT_ENABLED,
} from './graphql';
import {
    awaitRunningJobs,
    createSchedulerTestEnvironment,
    expectErrorCode,
    ids,
    localIn,
    minutesFromNow,
    serverInitOptions,
} from './utils/test-environment';

describe('Executor', () => {
    const { server, adminClient, shopClient } = createSchedulerTestEnvironment();
    let executor: ProductLaunchExecutorService;
    const events: Array<{ type: string; id: string; step?: string; outcome?: string }> = [];

    const create = (input: Record<string, unknown>) =>
        adminClient.query(CREATE_SCHEDULE, { input: { action: 'ENABLE', timezone: 'UTC', ...input } }).then(r => r.createProductLaunchSchedule);
    const getSchedule = (id: string) => adminClient.query(GET_SCHEDULE, { id }).then(r => r.productLaunchSchedule);
    const executions = (id: string) => adminClient.query(LIST_EXECUTIONS, { scheduleId: id }).then(r => r.productLaunchScheduleExecutions);
    const productEnabled = (id: string) => adminClient.query(GET_PRODUCT, { id }).then(r => r.product.enabled);
    const setEnabled = (id: string, enabled: boolean) => adminClient.query(UPDATE_PRODUCT_ENABLED, { id, enabled });
    const visibleInShop = (id: string) => shopClient.query(SHOP_PRODUCT, { id }).then(r => !!r.product);
    /** The database id behind an API id (TestingEntityIdStrategy encodes 5 as "T_5"). */
    const dbId = (id: string) => Number(id.replace('T_', ''));

    beforeAll(async () => {
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        executor = server.app.get(ProductLaunchExecutorService);
        server.app
            .get(EventBus)
            .ofType(ProductLaunchScheduleEvent)
            .subscribe(e => events.push({ type: e.type, id: `T_${String(e.schedule.id)}`, step: e.step, outcome: e.outcome }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        await server.destroy();
    });

    it('does nothing before the scheduled time', async () => {
        const schedule = await create({ productId: ids.laptop, action: 'DISABLE', scheduledAt: localIn(10) });
        const result = await executor.processDue(minutesFromNow(5));
        expect(result.processed).toBe(0);
        expect((await getSchedule(schedule.id)).status).toBe('PENDING');
        expect(await productEnabled(ids.laptop)).toBe(true);
        await adminClient.query(CANCEL_SCHEDULE, { id: schedule.id });
    });

    it('enables a product at the start time and the storefront shows it', async () => {
        await setEnabled(ids.camera, false);
        await awaitRunningJobs(adminClient);
        expect(await visibleInShop(ids.camera)).toBe(false);

        const schedule = await create({ productId: ids.camera, action: 'ENABLE', scheduledAt: localIn(2) });
        const result = await executor.processDue(minutesFromNow(3));
        expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });

        expect(await productEnabled(ids.camera)).toBe(true);
        expect(await visibleInShop(ids.camera)).toBe(true);
        const done = await getSchedule(schedule.id);
        expect(done).toMatchObject({ status: 'COMPLETED', nextStep: null, nextRunAt: null, attempts: 0, startEnabledBefore: false, startEnabledAfter: true });
        const { items } = await executions(schedule.id);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ step: 'START', action: 'ENABLE', outcome: 'SUCCEEDED', enabledBefore: false, enabledAfter: true, attempt: 1 });
        expect(items[0].ranLateBySeconds).toBeGreaterThanOrEqual(50);
        expect(events).toContainEqual({ type: 'executed', id: schedule.id, step: 'START', outcome: 'SUCCEEDED' });
    });

    it('records NO_CHANGE when the product already has the target state', async () => {
        const schedule = await create({ productId: ids.camera, action: 'ENABLE', scheduledAt: localIn(2) });
        await executor.processDue(minutesFromNow(3));
        expect((await executions(schedule.id)).items[0].outcome).toBe('NO_CHANGE');
        expect((await getSchedule(schedule.id)).status).toBe('COMPLETED');
    });

    it('disables for a time window and restores afterwards', async () => {
        const schedule = await create({ productId: ids.phone, action: 'DISABLE', scheduledAt: localIn(2), endAt: localIn(30), endAction: 'RESTORE' });
        await executor.processDue(minutesFromNow(3));
        expect(await productEnabled(ids.phone)).toBe(false);
        await awaitRunningJobs(adminClient);
        expect(await visibleInShop(ids.phone)).toBe(false);
        expect(await getSchedule(schedule.id)).toMatchObject({ status: 'ACTIVE', nextStep: 'END' });

        // not yet
        await executor.processDue(minutesFromNow(20));
        expect(await productEnabled(ids.phone)).toBe(false);

        await executor.processDue(minutesFromNow(31));
        expect(await productEnabled(ids.phone)).toBe(true);
        expect(await visibleInShop(ids.phone)).toBe(true);
        expect(await getSchedule(schedule.id)).toMatchObject({ status: 'COMPLETED', nextStep: null });
        const { items } = await executions(schedule.id);
        expect(items.map((e: any) => [e.step, e.action, e.outcome])).toEqual([
            ['END', 'RESTORE', 'SUCCEEDED'],
            ['START', 'DISABLE', 'SUCCEEDED'],
        ]);
    });

    it('does not restore a product that was changed manually during the window', async () => {
        const schedule = await create({ productId: ids.phone, action: 'DISABLE', scheduledAt: localIn(2), endAt: localIn(30), endAction: 'RESTORE' });
        await executor.processDue(minutesFromNow(3));
        expect(await productEnabled(ids.phone)).toBe(false);
        // an administrator enables it by hand
        await setEnabled(ids.phone, true);
        // ...and disables it again: it now has the start step's value, but restore must still work
        await setEnabled(ids.phone, false);
        await executor.processDue(minutesFromNow(31));
        // the product still had the value the start step set, so restore applies
        expect(await productEnabled(ids.phone)).toBe(true);

        const second = await create({ productId: ids.phone, action: 'DISABLE', scheduledAt: localIn(40), endAt: localIn(60), endAction: 'RESTORE' });
        await executor.processDue(minutesFromNow(41));
        await setEnabled(ids.phone, true); // manual change that sticks
        await executor.processDue(minutesFromNow(61));
        expect(await productEnabled(ids.phone)).toBe(true);
        const end = (await executions(second.id)).items[0];
        expect(end).toMatchObject({ step: 'END', outcome: 'SKIPPED' });
        expect(end.message).toContain('changed manually');
        expect((await getSchedule(second.id)).status).toBe('COMPLETED');
        expect(schedule.id).not.toBe(second.id);
    });

    it('applies an explicit end action even after a manual change', async () => {
        const schedule = await create({ productId: ids.tablet, action: 'ENABLE', scheduledAt: localIn(2), endAt: localIn(30), endAction: 'DISABLE' });
        await executor.processDue(minutesFromNow(3));
        await setEnabled(ids.tablet, false);
        await setEnabled(ids.tablet, true);
        await executor.processDue(minutesFromNow(31));
        expect(await productEnabled(ids.tablet)).toBe(false);
        expect((await executions(schedule.id)).items[0]).toMatchObject({ step: 'END', action: 'DISABLE', outcome: 'SUCCEEDED' });
        await setEnabled(ids.tablet, true);
    });

    it('retries a failing step with backoff, then marks it FAILED; retry runs it again', async () => {
        const productService = server.app.get(ProductService);
        const spy = vi.spyOn(productService, 'update').mockRejectedValue(new Error('Database unavailable'));
        await setEnabledDirect(ids.tablet, false);
        const schedule = await create({ productId: ids.tablet, action: 'ENABLE', scheduledAt: localIn(2) });

        const t1 = minutesFromNow(3);
        expect((await executor.processDue(t1)).failed).toBe(1);
        let state = await getSchedule(schedule.id);
        expect(state).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Database unavailable' });
        expect(new Date(state.nextRunAt).getTime()).toBe(t1.getTime() + 60_000);

        // not due until the backoff passed
        expect((await executor.processDue(new Date(t1.getTime() + 30_000))).processed).toBe(0);

        const t2 = new Date(t1.getTime() + 61_000);
        await executor.processDue(t2);
        state = await getSchedule(schedule.id);
        expect(state).toMatchObject({ status: 'PENDING', attempts: 2 });
        expect(new Date(state.nextRunAt).getTime()).toBe(t2.getTime() + 300_000);

        await executor.processDue(new Date(t2.getTime() + 301_000));
        state = await getSchedule(schedule.id);
        expect(state).toMatchObject({ status: 'FAILED', attempts: 3, nextStep: 'START', lastError: 'Database unavailable' });
        expect(events).toContainEqual({ type: 'failed', id: schedule.id, step: 'START', outcome: 'FAILED' });
        const history = await executions(schedule.id);
        expect(history.items.map((e: any) => [e.outcome, e.attempt])).toEqual([
            ['FAILED', 3],
            ['FAILED', 2],
            ['FAILED', 1],
        ]);
        // a failed step must not have changed the product
        expect(await productEnabled(ids.tablet)).toBe(false);

        // FAILED is final until retried
        expect((await executor.processDue(minutesFromNow(60))).processed).toBe(0);

        spy.mockRestore();
        const retried = await adminClient.query(RETRY_SCHEDULE, { id: schedule.id });
        expect(retried.retryProductLaunchSchedule).toMatchObject({ status: 'PENDING', attempts: 0 });
        await executor.processDue(minutesFromNow(61));
        expect(await productEnabled(ids.tablet)).toBe(true);
        expect(await getSchedule(schedule.id)).toMatchObject({ status: 'COMPLETED', attempts: 0, lastError: null });
        await expectErrorCode(adminClient.query(RETRY_SCHEDULE, { id: schedule.id }), 'INVALID_STATUS_TRANSITION');
    });

    it('releases a schedule whose worker crashed (expired lease) and runs it', async () => {
        await setEnabled(ids.laptop, true);
        const schedule = await create({ productId: ids.laptop, action: 'DISABLE', scheduledAt: localIn(2) });
        const repository = server.app.get(TransactionalConnection).rawConnection.getRepository(ProductLaunchSchedule);
        // simulate a worker that claimed it and died
        await repository.update({ id: dbId(schedule.id) }, { status: 'PROCESSING', attempts: 1, leaseExpiresAt: minutesFromNow(4), revision: 5 });

        // lease not yet expired: left alone
        expect(await executor.processDue(minutesFromNow(3))).toMatchObject({ released: 0, processed: 0 });
        expect((await getSchedule(schedule.id)).status).toBe('PROCESSING');

        const result = await executor.processDue(minutesFromNow(5));
        expect(result).toMatchObject({ released: 1, processed: 1, succeeded: 1 });
        expect(await productEnabled(ids.laptop)).toBe(false);
        expect((await getSchedule(schedule.id)).status).toBe('COMPLETED');
        expect((await executions(schedule.id)).items[0].attempt).toBe(2);
        await setEnabled(ids.laptop, true);
    });

    it('runs a step exactly once when several workers race for it', async () => {
        await setEnabled(ids.laptop, true);
        const productService = server.app.get(ProductService);
        const spy = vi.spyOn(productService, 'update');
        const schedule = await create({ productId: ids.laptop, action: 'DISABLE', scheduledAt: localIn(2) });
        const results = await Promise.all([1, 2, 3, 4].map(() => executor.processDue(minutesFromNow(3))));
        expect(results.reduce((sum, r) => sum + r.processed, 0)).toBe(1);
        expect(spy).toHaveBeenCalledTimes(1);
        expect((await executions(schedule.id)).totalItems).toBe(1);
        expect(await productEnabled(ids.laptop)).toBe(false);
        await setEnabled(ids.laptop, true);
    });

    it('cancels the schedules of a deleted product', async () => {
        const schedule = await create({ productId: ids.headphones, action: 'DISABLE', scheduledAt: localIn(60) });
        await adminClient.query(DELETE_PRODUCT, { id: ids.headphones });
        await new Promise(r => setTimeout(r, 300));
        const state = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(ProductLaunchSchedule)
            .findOneByOrFail({ id: dbId(schedule.id) });
        expect(state).toMatchObject({ status: 'CANCELLED', lastError: 'The product was deleted.' });
        expect(events).toContainEqual({ type: 'cancelled', id: schedule.id, step: undefined, outcome: undefined });
    });

    it('marks a step FAILED instead of running it when it is later than skipIfLateBy', async () => {
        const options = ProductLaunchSchedulerPlugin.options;
        options.skipIfLateBy = 600;
        try {
            const schedule = await create({ productId: ids.camera, action: 'DISABLE', scheduledAt: localIn(2) });
            await executor.processDue(minutesFromNow(30));
            expect(await productEnabled(ids.camera)).toBe(true);
            const state = await getSchedule(schedule.id);
            expect(state.status).toBe('FAILED');
            expect(state.lastError).toContain('Missed');
            expect((await executions(schedule.id)).items[0].outcome).toBe('SKIPPED');
        } finally {
            options.skipIfLateBy = undefined;
        }
    });

    it('runs through the real scheduled task', async () => {
        await setEnabled(ids.tablet, true);
        const schedule = await create({ productId: ids.tablet, action: 'DISABLE', scheduledAt: localIn(0) });
        const { runScheduledTask } = await adminClient.query(RUN_SCHEDULED_TASK, { id: PROCESS_DUE_TASK_ID });
        expect(runScheduledTask.success).toBe(true);
        for (let i = 0; i < 50 && (await getSchedule(schedule.id)).status !== 'COMPLETED'; i++) {
            await new Promise(r => setTimeout(r, 100));
        }
        expect((await getSchedule(schedule.id)).status).toBe('COMPLETED');
        expect(await productEnabled(ids.tablet)).toBe(false);
    });

    /** Sets enabled without going through ProductService (which may be mocked). */
    async function setEnabledDirect(id: string, enabled: boolean) {
        await server.app.get(TransactionalConnection).rawConnection.getRepository(Product).update({ id: dbId(id) }, { enabled });
    }
});

