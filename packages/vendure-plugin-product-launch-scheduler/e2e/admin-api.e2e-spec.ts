import { CurrencyCode, LanguageCode } from '@vendure/core';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProductLaunchExecutorService } from '../src';

import {
    CANCEL_SCHEDULE,
    CREATE_SCHEDULE,
    GET_SCHEDULE,
    LIST_SCHEDULES,
    SCHEDULER_STATUS,
    TIME_PREVIEW,
    UPDATE_SCHEDULE,
} from './graphql';
import {
    createSchedulerTestEnvironment,
    expectErrorCode,
    ids,
    localIn,
    minutesFromNow,
    serverInitOptions,
} from './utils/test-environment';

describe('Admin API', () => {
    const { server, adminClient } = createSchedulerTestEnvironment();
    let executor: ProductLaunchExecutorService;

    const create = (input: Record<string, unknown>) =>
        adminClient.query(CREATE_SCHEDULE, { input: { action: 'ENABLE', timezone: 'UTC', ...input } }).then(r => r.createProductLaunchSchedule);

    beforeAll(async () => {
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        executor = server.app.get(ProductLaunchExecutorService);
    });

    afterAll(async () => {
        await server.destroy();
    });

    it('reports that the scheduler is running', async () => {
        const { productLaunchSchedulerStatus } = await adminClient.query(SCHEDULER_STATUS);
        expect(productLaunchSchedulerStatus).toEqual({ schedulerRunning: true, pollSchedule: '* * * * *', maxAttempts: 3 });
    });

    it('previews local times, DST gaps and invalid zones', async () => {
        const ok = await adminClient.query(TIME_PREVIEW, { localTime: '2027-07-01T10:00', timezone: 'Europe/Berlin' });
        expect(ok.productLaunchTimePreview).toMatchObject({ valid: true, instant: '2027-07-01T08:00:00.000Z', ambiguous: false });
        const gap = await adminClient.query(TIME_PREVIEW, { localTime: '2027-03-28T02:30', timezone: 'Europe/Berlin' });
        expect(gap.productLaunchTimePreview).toMatchObject({ valid: false, errorCode: 'INVALID_LOCAL_TIME', nextValidLocalTime: '2027-03-28T03:00' });
        const zone = await adminClient.query(TIME_PREVIEW, { localTime: '2027-07-01T10:00', timezone: 'Mars/Base' });
        expect(zone.productLaunchTimePreview).toMatchObject({ valid: false, errorCode: 'INVALID_TIMEZONE' });
    });

    describe('create', () => {
        it('stores the UTC instant and what was entered', async () => {
            const schedule = await create({
                productId: ids.laptop,
                name: 'Black Friday',
                description: 'Laptop launch',
                scheduledAt: '2027-11-26T09:00',
                timezone: 'Europe/Berlin',
                endAt: '2027-11-29T23:59',
            });
            expect(schedule).toMatchObject({
                productId: ids.laptop,
                product: { id: ids.laptop, name: 'Laptop' },
                name: 'Black Friday',
                description: 'Laptop launch',
                action: 'ENABLE',
                scheduledAt: '2027-11-26T08:00:00.000Z',
                endAt: '2027-11-29T22:59:00.000Z',
                endAction: 'DISABLE',
                timezone: 'Europe/Berlin',
                localScheduledAt: '2027-11-26T09:00',
                localEndAt: '2027-11-29T23:59',
                status: 'PENDING',
                nextStep: 'START',
                nextRunAt: '2027-11-26T08:00:00.000Z',
                attempts: 0,
                createdByUserId: 'T_1',
            });
            await adminClient.query(CANCEL_SCHEDULE, { id: schedule.id });
        });

        it('rejects invalid input with typed errors', async () => {
            await expectErrorCode(create({ productId: ids.laptop, scheduledAt: localIn(60), timezone: 'Nowhere/City' }), 'INVALID_TIMEZONE');
            const gap = await expectErrorCode(
                create({ productId: ids.laptop, scheduledAt: '2027-03-28T02:30', timezone: 'Europe/Berlin' }),
                'INVALID_LOCAL_TIME',
            );
            expect(gap).toContain('2027-03-28T03:00');
            await expectErrorCode(create({ productId: ids.laptop, scheduledAt: '2027-11-26 09:00' }), 'INVALID_INPUT');
            await expectErrorCode(create({ productId: ids.laptop, scheduledAt: localIn(-10) }), 'SCHEDULE_IN_PAST');
            await expectErrorCode(
                create({ productId: ids.laptop, scheduledAt: localIn(60), endAt: localIn(30) }),
                'END_BEFORE_START',
            );
            await expectErrorCode(
                create({ productId: ids.laptop, scheduledAt: localIn(60), endAt: localIn(60) }),
                'END_BEFORE_START',
            );
            await expectErrorCode(create({ productId: 'T_999', scheduledAt: localIn(60) }), 'PRODUCT_NOT_FOUND');
            await expectErrorCode(
                create({ productId: ids.laptop, scheduledAt: localIn(60), endAction: 'RESTORE' }),
                'INVALID_INPUT',
            );
        });

        it('accepts a time up to one minute in the past', async () => {
            const schedule = await create({ productId: ids.laptop, scheduledAt: localIn(0) });
            expect(schedule.status).toBe('PENDING');
            await adminClient.query(CANCEL_SCHEDULE, { id: schedule.id });
        });
    });

    describe('conflicts', () => {
        let window: any;

        beforeAll(async () => {
            window = await create({ productId: ids.camera, name: 'Window', scheduledAt: localIn(60), endAt: localIn(180) });
        });

        afterAll(async () => {
            await adminClient.query(CANCEL_SCHEDULE, { id: window.id });
        });

        it('rejects overlapping schedules for the same product, naming the conflict', async () => {
            const message = await expectErrorCode(create({ productId: ids.camera, scheduledAt: localIn(120) }), 'SCHEDULE_CONFLICT');
            expect(message).toContain(`schedule ${window.id as string}`);
            expect(message).toContain('"Window"');
            await expectErrorCode(create({ productId: ids.camera, scheduledAt: localIn(30), endAt: localIn(240) }), 'SCHEDULE_CONFLICT');
            // a step at exactly the same time as the end
            await expectErrorCode(create({ productId: ids.camera, scheduledAt: localIn(180) }), 'SCHEDULE_CONFLICT');
        });

        it('allows sequential schedules and other products', async () => {
            const later = await create({ productId: ids.camera, action: 'DISABLE', scheduledAt: localIn(240) });
            const other = await create({ productId: ids.phone, scheduledAt: localIn(120) });
            await adminClient.query(CANCEL_SCHEDULE, { id: later.id });
            await adminClient.query(CANCEL_SCHEDULE, { id: other.id });
        });

        it('ignores cancelled schedules', async () => {
            const a = await create({ productId: ids.phone, scheduledAt: localIn(300) });
            await adminClient.query(CANCEL_SCHEDULE, { id: a.id });
            const b = await create({ productId: ids.phone, scheduledAt: localIn(300) });
            await adminClient.query(CANCEL_SCHEDULE, { id: b.id });
        });

        it('checks conflicts on update, excluding the schedule itself', async () => {
            const own = await adminClient.query(UPDATE_SCHEDULE, { input: { id: window.id, endAt: localIn(200) } });
            expect(own.updateProductLaunchSchedule.localEndAt).toBe(localIn(200));
            const other = await create({ productId: ids.camera, scheduledAt: localIn(400) });
            await expectErrorCode(
                adminClient.query(UPDATE_SCHEDULE, { input: { id: other.id, scheduledAt: localIn(100) } }),
                'SCHEDULE_CONFLICT',
            );
            await adminClient.query(CANCEL_SCHEDULE, { id: other.id });
        });
    });

    describe('list', () => {
        const created: any[] = [];

        beforeAll(async () => {
            for (const [productId, minutes] of [
                [ids.tablet, 500],
                [ids.tablet, 600],
                [ids.headphones, 550],
            ] as const) {
                created.push(await create({ productId, scheduledAt: localIn(minutes) }));
            }
        });

        afterAll(async () => {
            for (const schedule of created) {
                await adminClient.query(CANCEL_SCHEDULE, { id: schedule.id }).catch(() => undefined);
            }
        });

        it('filters by product and status, sorted by start time', async () => {
            const { productLaunchSchedules } = await adminClient.query(LIST_SCHEDULES, {
                options: { productId: ids.tablet, status: ['PENDING'] },
            });
            expect(productLaunchSchedules.totalItems).toBe(2);
            expect(productLaunchSchedules.items.map((s: any) => s.id)).toEqual([created[0].id, created[1].id]);
        });

        it('paginates and sorts descending', async () => {
            const { productLaunchSchedules } = await adminClient.query(LIST_SCHEDULES, {
                options: { status: ['PENDING'], take: 2, sortOrder: 'DESC' },
            });
            expect(productLaunchSchedules.totalItems).toBe(3);
            expect(productLaunchSchedules.items.map((s: any) => s.id)).toEqual([created[1].id, created[2].id]);
        });

        it('filters by date range', async () => {
            const { productLaunchSchedules } = await adminClient.query(LIST_SCHEDULES, {
                options: { status: ['PENDING'], from: minutesFromNow(540), to: minutesFromNow(560) },
            });
            expect(productLaunchSchedules.items.map((s: any) => s.id)).toEqual([created[2].id]);
        });

        it('filters cancelled schedules by status', async () => {
            const { productLaunchSchedules } = await adminClient.query(LIST_SCHEDULES, {
                options: { status: ['CANCELLED'], take: 100 },
            });
            expect(productLaunchSchedules.totalItems).toBeGreaterThan(3);
            expect(productLaunchSchedules.items.every((s: any) => s.status === 'CANCELLED')).toBe(true);
        });
    });

    describe('update and status rules', () => {
        it('changes everything while PENDING', async () => {
            const schedule = await create({ productId: ids.headphones, scheduledAt: localIn(700) });
            const { updateProductLaunchSchedule } = await adminClient.query(UPDATE_SCHEDULE, {
                input: {
                    id: schedule.id,
                    action: 'DISABLE',
                    scheduledAt: '2027-06-01T12:00',
                    timezone: 'America/New_York',
                    endAt: '2027-06-02T12:00',
                    endAction: 'RESTORE',
                    name: 'Renamed',
                },
            });
            expect(updateProductLaunchSchedule).toMatchObject({
                action: 'DISABLE',
                scheduledAt: '2027-06-01T16:00:00.000Z',
                nextRunAt: '2027-06-01T16:00:00.000Z',
                endAt: '2027-06-02T16:00:00.000Z',
                endAction: 'RESTORE',
                timezone: 'America/New_York',
                name: 'Renamed',
                status: 'PENDING',
            });
            const removed = await adminClient.query(UPDATE_SCHEDULE, { input: { id: schedule.id, removeEnd: true } });
            expect(removed.updateProductLaunchSchedule).toMatchObject({ endAt: null, endAction: null, localEndAt: null });
            await adminClient.query(CANCEL_SCHEDULE, { id: schedule.id });
        });

        it('changes only the end once started, and cancelling skips the end step', async () => {
            const schedule = await create({ productId: ids.headphones, scheduledAt: localIn(1), endAt: localIn(600) });
            await executor.processDue(minutesFromNow(2));
            const started = (await adminClient.query(GET_SCHEDULE, { id: schedule.id })).productLaunchSchedule;
            expect(started).toMatchObject({ status: 'ACTIVE', nextStep: 'END', nextRunAt: started.endAt });

            await expectErrorCode(
                adminClient.query(UPDATE_SCHEDULE, { input: { id: schedule.id, scheduledAt: localIn(5) } }),
                'INVALID_STATUS_TRANSITION',
            );
            const moved = await adminClient.query(UPDATE_SCHEDULE, { input: { id: schedule.id, endAt: localIn(900), endAction: 'RESTORE' } });
            expect(moved.updateProductLaunchSchedule).toMatchObject({
                status: 'ACTIVE',
                localEndAt: localIn(900),
                endAction: 'RESTORE',
                nextRunAt: moved.updateProductLaunchSchedule.endAt,
            });
            await expectErrorCode(
                adminClient.query(UPDATE_SCHEDULE, { input: { id: schedule.id, endAt: localIn(-30) } }),
                'SCHEDULE_IN_PAST',
            );

            const cancelled = await adminClient.query(CANCEL_SCHEDULE, { id: schedule.id });
            expect(cancelled.cancelProductLaunchSchedule).toMatchObject({ status: 'CANCELLED', nextStep: null, nextRunAt: null });
            await expectErrorCode(adminClient.query(CANCEL_SCHEDULE, { id: schedule.id }), 'INVALID_STATUS_TRANSITION');
            await expectErrorCode(
                adminClient.query(UPDATE_SCHEDULE, { input: { id: schedule.id, name: 'x' } }),
                'INVALID_STATUS_TRANSITION',
            );
        });

        it('completes an ACTIVE schedule when its end is removed', async () => {
            const schedule = await create({ productId: ids.headphones, scheduledAt: localIn(1), endAt: localIn(600) });
            await executor.processDue(minutesFromNow(2));
            const { updateProductLaunchSchedule } = await adminClient.query(UPDATE_SCHEDULE, { input: { id: schedule.id, removeEnd: true } });
            expect(updateProductLaunchSchedule).toMatchObject({ status: 'COMPLETED', nextStep: null, endAt: null });
        });
    });

    describe('permissions and channels', () => {
        it('allows reading but not changing with read-only permissions', async () => {
            const { createRole } = await adminClient.query(
                gql`
                    mutation {
                        createRole(input: { code: "catalog-reader", description: "Catalog reader", permissions: [ReadCatalog] }) {
                            id
                        }
                    }
                `,
            );
            await adminClient.query(
                gql`
                    mutation ($roleId: ID!) {
                        createAdministrator(
                            input: { firstName: "Read", lastName: "Only", emailAddress: "reader@test.com", password: "test", roleIds: [$roleId] }
                        ) {
                            id
                        }
                    }
                `,
                { roleId: createRole.id },
            );
            await adminClient.asUserWithCredentials('reader@test.com', 'test');
            const { productLaunchSchedules } = await adminClient.query(LIST_SCHEDULES, { options: { take: 1 } });
            expect(productLaunchSchedules.totalItems).toBeGreaterThan(0);
            await expectErrorCode(create({ productId: ids.laptop, scheduledAt: localIn(60) }), 'FORBIDDEN');
            await adminClient.asSuperAdmin();
        });

        it('only shows and accepts products of the active channel', async () => {
            const { zones } = await adminClient.query(gql`{ zones { items { id } } }`);
            const zoneId = zones.items[0].id;
            await adminClient.query(
                gql`
                    mutation ($zoneId: ID!) {
                        createChannel(
                            input: {
                                code: "channel-b"
                                token: "channel-b"
                                defaultLanguageCode: ${LanguageCode.en}
                                pricesIncludeTax: false
                                defaultCurrencyCode: ${CurrencyCode.USD}
                                defaultShippingZoneId: $zoneId
                                defaultTaxZoneId: $zoneId
                            }
                        ) {
                            ... on Channel {
                                id
                            }
                        }
                    }
                `,
                { zoneId },
            );
            adminClient.setChannelToken('channel-b');
            const { productLaunchSchedules } = await adminClient.query(LIST_SCHEDULES);
            expect(productLaunchSchedules.totalItems).toBe(0);
            await expectErrorCode(create({ productId: ids.laptop, scheduledAt: localIn(60) }), 'PRODUCT_NOT_FOUND');
            adminClient.setChannelToken('e2e-default-channel');
        });
    });
});
