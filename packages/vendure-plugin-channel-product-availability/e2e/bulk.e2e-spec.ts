import { EventBus } from '@vendure/core';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProductChannelAvailabilityEvent } from '../src';
import {
    CREATE_ADMINISTRATOR,
    CREATE_ROLE,
    REMOVE_PRODUCTS_FROM_CHANNEL,
    SHOP_GET_PRODUCT,
} from './graphql';
import { CHANNEL_B_TOKEN, DEFAULT_CHANNEL_TOKEN, ids, serverInitOptions, setupChannels } from './utils/setup';
import { awaitRunningJobs, createAvailabilityTestEnvironment } from './utils/test-environment';

const SET_MANY = gql`
    mutation ($input: SetProductChannelAvailabilitiesInput!) {
        setProductChannelAvailabilities(input: $input) {
            updated
            unchanged
            skipped {
                productId
                channelId
                reason
            }
        }
    }
`;
const CLEAR_MANY = gql`
    mutation ($input: ClearProductChannelAvailabilitiesInput!) {
        clearProductChannelAvailabilities(input: $input) {
            updated
            unchanged
            skipped {
                productId
                channelId
                reason
            }
        }
    }
`;
const LIST = gql`
    query ($options: ProductChannelAvailabilityOverrideListOptions) {
        productChannelAvailabilityOverrides(options: $options) {
            totalItems
            items {
                productId
                channelId
                enabled
                productName
                productEnabled
            }
        }
    }
`;

describe('bulk operations', () => {
    const { server, adminClient, shopClient } = createAvailabilityTestEnvironment();
    let channelA: string;
    let channelB: string;
    const events: Array<{ type: string; productId: string; channelId: string }> = [];

    beforeAll(async () => {
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        ({ channelA, channelB } = await setupChannels(adminClient));
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(REMOVE_PRODUCTS_FROM_CHANNEL, { input: { productIds: [ids.headphones], channelId: channelB } });
        await awaitRunningJobs(adminClient);
        server.app
            .get(EventBus)
            .ofType(ProductChannelAvailabilityEvent)
            .subscribe(e => events.push({ type: e.type, productId: `T_${String(e.productId)}`, channelId: `T_${String(e.channelId)}` }));
    });

    afterAll(async () => {
        await server.destroy();
    });

    const visibleIn = async (token: string, productId: string) => {
        shopClient.setChannelToken(token);
        const { product } = await shopClient.query(SHOP_GET_PRODUCT, { id: productId });
        return !!product;
    };

    it('applies to every pair, skipping products not assigned to a channel', async () => {
        events.length = 0;
        const { setProductChannelAvailabilities: result } = await adminClient.query(SET_MANY, {
            input: { productIds: [ids.laptop, ids.camera, ids.headphones], channelIds: [channelA, channelB], enabled: false },
        });
        expect(result.updated).toBe(5);
        expect(result.unchanged).toBe(0);
        expect(result.skipped).toEqual([
            { productId: ids.headphones, channelId: channelB, reason: 'Product is not assigned to channel "channel-b"' },
        ]);
        await new Promise(r => setTimeout(r, 100));
        expect(events.filter(e => e.type === 'set')).toHaveLength(5);

        for (const token of [DEFAULT_CHANNEL_TOKEN, CHANNEL_B_TOKEN]) {
            expect(await visibleIn(token, ids.laptop)).toBe(false);
            expect(await visibleIn(token, ids.camera)).toBe(false);
            expect(await visibleIn(token, ids.tablet)).toBe(true);
        }
        expect(await visibleIn(DEFAULT_CHANNEL_TOKEN, ids.headphones)).toBe(false);
    });

    it('is idempotent', async () => {
        events.length = 0;
        const { setProductChannelAvailabilities: result } = await adminClient.query(SET_MANY, {
            input: { productIds: [ids.laptop, ids.camera, ids.headphones], channelIds: [channelA, channelB], enabled: false },
        });
        expect(result).toMatchObject({ updated: 0, unchanged: 5 });
        expect(result.skipped).toHaveLength(1);
        expect(events).toHaveLength(0);
    });

    it('changes only pairs whose value differs', async () => {
        const { setProductChannelAvailabilities: result } = await adminClient.query(SET_MANY, {
            input: { productIds: [ids.laptop, ids.tablet], channelIds: [channelA], enabled: false },
        });
        expect(result).toMatchObject({ updated: 1, unchanged: 1, skipped: [] });
    });

    it('lists a branch with product names, a name search and a state filter', async () => {
        const all = (await adminClient.query(LIST, { options: { channelId: channelA } })).productChannelAvailabilityOverrides;
        expect(all.totalItems).toBe(4);
        const byName = (await adminClient.query(LIST, { options: { channelId: channelA, productName: 'LAP' } }))
            .productChannelAvailabilityOverrides;
        expect(byName.items).toEqual([
            { productId: ids.laptop, channelId: channelA, enabled: false, productName: 'Laptop', productEnabled: true },
        ]);
        const page = (await adminClient.query(LIST, { options: { channelId: channelA, enabled: false, take: 2, skip: 2 } }))
            .productChannelAvailabilityOverrides;
        expect(page.totalItems).toBe(4);
        expect(page.items).toHaveLength(2);
        const onOnly = (await adminClient.query(LIST, { options: { channelId: channelA, enabled: true } }))
            .productChannelAvailabilityOverrides;
        expect(onOnly.totalItems).toBe(0);
    });

    it('clears in bulk', async () => {
        events.length = 0;
        const { clearProductChannelAvailabilities: result } = await adminClient.query(CLEAR_MANY, {
            input: { productIds: [ids.laptop, ids.camera, ids.phone], channelIds: [channelA, channelB] },
        });
        expect(result).toMatchObject({ updated: 4, unchanged: 2, skipped: [] });
        await new Promise(r => setTimeout(r, 100));
        expect(events.filter(e => e.type === 'cleared')).toHaveLength(4);
        expect(await visibleIn(DEFAULT_CHANNEL_TOKEN, ids.laptop)).toBe(true);
        expect(await visibleIn(CHANNEL_B_TOKEN, ids.camera)).toBe(true);
    });

    it('reports unknown products; an unknown channel is refused like one without permission', async () => {
        const { setProductChannelAvailabilities: result } = await adminClient.query(SET_MANY, {
            input: { productIds: ['T_999', ids.laptop], channelIds: [channelA], enabled: true },
        });
        expect(result.updated).toBe(1);
        expect(result.skipped).toEqual([{ productId: 'T_999', channelId: channelA, reason: 'Product not found' }]);
        await expect(
            adminClient.query(SET_MANY, { input: { productIds: [ids.laptop], channelIds: ['T_999'], enabled: true } }),
        ).rejects.toThrow(/not currently authorized/);
        await adminClient.query(CLEAR_MANY, { input: { productIds: [ids.laptop], channelIds: [channelA] } });
    });

    it('refuses the whole batch without permission in every channel', async () => {
        const { createRole } = await adminClient.query(CREATE_ROLE, {
            input: { code: 'branch-a-catalog', description: 'Branch A', permissions: ['ReadCatalog', 'UpdateCatalog'], channelIds: [channelA] },
        });
        await adminClient.query(CREATE_ADMINISTRATOR, {
            input: { firstName: 'A', lastName: 'Admin', emailAddress: 'a@branch.test', password: 'test', roleIds: [createRole.id] },
        });
        await adminClient.asUserWithCredentials('a@branch.test', 'test');
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
        await expect(
            adminClient.query(SET_MANY, { input: { productIds: [ids.tablet], channelIds: [channelA, channelB], enabled: false } }),
        ).rejects.toThrow(/not currently authorized/);
        // nothing changed
        expect((await adminClient.query(LIST, { options: { channelId: channelA, productId: ids.tablet } }))
            .productChannelAvailabilityOverrides.items[0].enabled).toBe(false);
        // allowed in its own channel
        const { setProductChannelAvailabilities: ok } = await adminClient.query(SET_MANY, {
            input: { productIds: [ids.tablet], channelIds: [channelA], enabled: true },
        });
        expect(ok.updated).toBe(1);
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
    });

    it('caps the size of one call', async () => {
        const productIds = Array.from({ length: 501 }, (_, i) => `T_${i + 1}`);
        await expect(
            adminClient.query(SET_MANY, { input: { productIds, channelIds: [channelA, channelB], enabled: false } }),
        ).rejects.toThrow(/Too many changes in one call: 501 products × 2 channels = 1002 pairs \(at most 1000\)/);
    });
});
