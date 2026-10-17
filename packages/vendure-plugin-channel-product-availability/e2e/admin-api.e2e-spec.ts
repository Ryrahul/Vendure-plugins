import { CurrencyCode, LanguageCode, TransactionalConnection } from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ChannelProductAvailabilityMigration1792195200000, ProductChannelAvailability } from '../src';
import {
    CLEAR_AVAILABILITY,
    CREATE_ADMINISTRATOR,
    CREATE_CHANNEL,
    CREATE_ROLE,
    DELETE_PRODUCT,
    GET_AVAILABILITIES,
    GET_AVAILABILITY,
    GET_OVERRIDES,
    GET_ZONES,
    REMOVE_PRODUCTS_FROM_CHANNEL,
    SET_AVAILABILITY,
} from './graphql';
import { CHANNEL_B_TOKEN, DEFAULT_CHANNEL_TOKEN, ids, serverInitOptions, setupChannels } from './utils/setup';
import { createAvailabilityTestEnvironment } from './utils/test-environment';

describe('Admin API', () => {
    const { server, adminClient } = createAvailabilityTestEnvironment();
    let channelA: string;
    let channelB: string;

    beforeAll(async () => {
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        ({ channelA, channelB } = await setupChannels(adminClient));
    });

    afterAll(async () => {
        await server.destroy();
    });

    async function overridesFor(productId: string, channelId: string) {
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
        const { productChannelAvailabilityOverrides } = await adminClient.query(GET_OVERRIDES, {
            options: { channelId, productId },
        });
        return productChannelAvailabilityOverrides;
    }

    describe('queries', () => {
        it('reports inherited state by default', async () => {
            const { productChannelAvailability } = await adminClient.query(GET_AVAILABILITY, { productId: ids.camera });
            expect(productChannelAvailability).toEqual({
                productId: ids.camera,
                channelId: channelA,
                channelCode: '__default_channel__',
                globalEnabled: true,
                override: null,
                overrideState: 'INHERITED',
                effectiveEnabled: true,
                productInChannel: true,
            });
        });

        it('lists every channel the product is assigned to', async () => {
            await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.camera, channelId: channelB, enabled: false } });
            const { productChannelAvailabilities } = await adminClient.query(GET_AVAILABILITIES, { productId: ids.camera });
            expect(
                productChannelAvailabilities.map((a: any) => [a.channelCode, a.overrideState, a.effectiveEnabled]),
            ).toEqual([
                ['__default_channel__', 'INHERITED', true],
                ['channel-b', 'DISABLED', false],
            ]);
            await adminClient.query(CLEAR_AVAILABILITY, { input: { productId: ids.camera, channelId: channelB } });
        });
    });

    describe('validation', () => {
        it('rejects unknown products', async () => {
            await expect(
                adminClient.query(SET_AVAILABILITY, { input: { productId: 'T_999', enabled: true } }),
            ).rejects.toThrow(/No Product with the id/);
        });

        it('rejects products not assigned to the channel and does not assign them', async () => {
            const { zones } = await adminClient.query(GET_ZONES);
            const { createChannel } = await adminClient.query(CREATE_CHANNEL, {
                input: {
                    code: 'channel-c',
                    token: 'channel-c-token',
                    defaultLanguageCode: LanguageCode.en,
                    pricesIncludeTax: false,
                    defaultCurrencyCode: CurrencyCode.USD,
                    defaultShippingZoneId: zones.items[0].id,
                    defaultTaxZoneId: zones.items[0].id,
                },
            });
            await expect(
                adminClient.query(SET_AVAILABILITY, {
                    input: { productId: ids.camera, channelId: createChannel.id, enabled: true },
                }),
            ).rejects.toThrow(/is not assigned to channel "channel-c"/);
            const { productChannelAvailabilities } = await adminClient.query(GET_AVAILABILITIES, { productId: ids.camera });
            expect(productChannelAvailabilities.map((a: any) => a.channelCode)).not.toContain('channel-c');
        });
    });

    describe('writes', () => {
        it('set is idempotent and keeps a single row', async () => {
            for (let i = 0; i < 3; i++) {
                await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.tablet, enabled: false } });
            }
            const overrides = await overridesFor(ids.tablet, channelA);
            expect(overrides.totalItems).toBe(1);
            expect(overrides.items[0].enabled).toBe(false);
        });

        it('clear is idempotent', async () => {
            await adminClient.query(CLEAR_AVAILABILITY, { input: { productId: ids.tablet } });
            const { clearProductChannelAvailability } = await adminClient.query(CLEAR_AVAILABILITY, {
                input: { productId: ids.tablet },
            });
            expect(clearProductChannelAvailability.overrideState).toBe('INHERITED');
            expect((await overridesFor(ids.tablet, channelA)).totalItems).toBe(0);
        });

        it('concurrent writes never produce duplicate rows', async () => {
            await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                    adminClient.query(SET_AVAILABILITY, { input: { productId: ids.phone, enabled: i % 2 === 0 } }),
                ),
            );
            expect((await overridesFor(ids.phone, channelA)).totalItems).toBe(1);
        });
    });

    describe('authorization', () => {
        const email = 'channel-b-admin@test.com';
        const readOnlyEmail = 'readonly-admin@test.com';
        const password = 'test';

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const { createRole } = await adminClient.query(CREATE_ROLE, {
                input: {
                    code: 'channel-b-catalog',
                    description: 'Catalog manager for channel B only',
                    permissions: ['ReadCatalog', 'UpdateCatalog'],
                    channelIds: [channelB],
                },
            });
            await adminClient.query(CREATE_ADMINISTRATOR, {
                input: { firstName: 'B', lastName: 'Admin', emailAddress: email, password, roleIds: [createRole.id] },
            });
            const { createRole: readOnlyRole } = await adminClient.query(CREATE_ROLE, {
                input: {
                    code: 'read-only-catalog',
                    description: 'Read-only catalog in channel A',
                    permissions: ['ReadCatalog'],
                    channelIds: [channelA],
                },
            });
            await adminClient.query(CREATE_ADMINISTRATOR, {
                input: {
                    firstName: 'Read',
                    lastName: 'Only',
                    emailAddress: readOnlyEmail,
                    password,
                    roleIds: [readOnlyRole.id],
                },
            });
        });

        afterAll(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
        });

        it('a channel-B admin can manage channel B', async () => {
            adminClient.setChannelToken(CHANNEL_B_TOKEN);
            await adminClient.asUserWithCredentials(email, password);
            const { setProductChannelAvailability } = await adminClient.query(SET_AVAILABILITY, {
                input: { productId: ids.headphones, enabled: false },
            });
            expect(setProductChannelAvailability.channelId).toBe(channelB);
        });

        it('a channel-B admin cannot target channel A by passing channelId', async () => {
            adminClient.setChannelToken(CHANNEL_B_TOKEN);
            await adminClient.asUserWithCredentials(email, password);
            await expect(
                adminClient.query(SET_AVAILABILITY, {
                    input: { productId: ids.headphones, channelId: channelA, enabled: false },
                }),
            ).rejects.toThrow(/You are not currently authorized/);
            await expect(
                adminClient.query(GET_AVAILABILITY, { productId: ids.headphones, channelId: channelA }),
            ).rejects.toThrow(/You are not currently authorized/);
        });

        it('a channel-B admin only sees channel B in the per-channel listing', async () => {
            adminClient.setChannelToken(CHANNEL_B_TOKEN);
            await adminClient.asUserWithCredentials(email, password);
            const { productChannelAvailabilities } = await adminClient.query(GET_AVAILABILITIES, {
                productId: ids.headphones,
            });
            expect(productChannelAvailabilities.map((a: any) => a.channelCode)).toEqual(['channel-b']);
        });

        it('a read-only admin can read but not write', async () => {
            adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            await adminClient.asUserWithCredentials(readOnlyEmail, password);
            const { productChannelAvailability } = await adminClient.query(GET_AVAILABILITY, {
                productId: ids.headphones,
            });
            expect(productChannelAvailability.overrideState).toBe('INHERITED');
            await expect(
                adminClient.query(SET_AVAILABILITY, { input: { productId: ids.headphones, enabled: false } }),
            ).rejects.toThrow(/You are not currently authorized/);
        });

        it('superadmin state is unaffected by the rejected writes', async () => {
            expect((await overridesFor(ids.headphones, channelA)).totalItems).toBe(0);
            expect((await overridesFor(ids.headphones, channelB)).items[0].enabled).toBe(false);
        });
    });

    describe('lifecycle consistency', () => {
        it('removing a product from a channel removes its override there', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            expect((await overridesFor(ids.headphones, channelB)).totalItems).toBe(1);
            await adminClient.query(REMOVE_PRODUCTS_FROM_CHANNEL, {
                input: { productIds: [ids.headphones], channelId: channelB },
            });
            await waitFor(async () => (await overridesFor(ids.headphones, channelB)).totalItems === 0);
        });

        it('deleting a product removes all its overrides', async () => {
            await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.headphones, enabled: false } });
            expect((await overridesFor(ids.headphones, channelA)).totalItems).toBe(1);
            await adminClient.query(DELETE_PRODUCT, { id: ids.headphones });
            await waitFor(async () => (await overridesFor(ids.headphones, channelA)).totalItems === 0);
        });
    });

    describe('migration', () => {
        it('down() drops and up() recreates the table with indexes and foreign keys', async () => {
            const connection = server.app.get(TransactionalConnection).rawConnection;
            const metadata = connection.getMetadata(ProductChannelAvailability);
            const queryRunner = connection.createQueryRunner();
            const migration = new ChannelProductAvailabilityMigration1792195200000();
            try {
                await migration.down(queryRunner);
                expect(await queryRunner.hasTable(metadata.tablePath)).toBe(false);
                await migration.up(queryRunner);
                const table = await queryRunner.getTable(metadata.tablePath);
                expect(table).toBeDefined();
                expect(table!.columns.map(c => c.name).sort()).toEqual(
                    ['channelId', 'createdAt', 'enabled', 'id', 'productId', 'updatedAt'].sort(),
                );
                const uniqueIndex = table!.indices.find(
                    i => i.isUnique && [...i.columnNames].sort().join() === 'channelId,productId',
                );
                expect(uniqueIndex).toBeDefined();
                expect(table!.foreignKeys.map(fk => fk.referencedTableName).sort()).toEqual(['channel', 'product']);
                expect(table!.foreignKeys.every(fk => fk.onDelete === 'CASCADE')).toBe(true);
                // up() is a no-op when the table exists
                await migration.up(queryRunner);
            } finally {
                await queryRunner.release();
            }
            // the plugin still works on the migrated table
            const { setProductChannelAvailability } = await adminClient.query(SET_AVAILABILITY, {
                input: { productId: ids.camera, enabled: false },
            });
            expect(setProductChannelAvailability.overrideState).toBe('DISABLED');
        });
    });
});

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await condition()) {
            return;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Condition not met in time');
}
