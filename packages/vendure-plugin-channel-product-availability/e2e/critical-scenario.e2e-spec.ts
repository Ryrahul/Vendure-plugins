/**
 * The critical scenario from the specification, step by step, asserting catalog
 * discovery (detail, list, collection, search) and purchasing in both channels.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    ADD_ITEM_TO_ORDER,
    ADMIN_GET_PRODUCT,
    CLEAR_AVAILABILITY,
    SET_AVAILABILITY,
    SHOP_COLLECTION_VARIANTS,
    SHOP_GET_PRODUCT,
    SHOP_GET_PRODUCTS,
    SHOP_SEARCH,
    UPDATE_PRODUCT,
} from './graphql';
import { CHANNEL_B_TOKEN, DEFAULT_CHANNEL_TOKEN, ids, serverInitOptions, setupChannels } from './utils/setup';
import { awaitRunningJobs, createAvailabilityTestEnvironment } from './utils/test-environment';

describe('critical scenario: global disabled + per-channel overrides', () => {
    const { server, adminClient, shopClient } = createAvailabilityTestEnvironment();
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

    async function discovery(token: string) {
        shopClient.setChannelToken(token);
        const { product } = await shopClient.query(SHOP_GET_PRODUCT, { id: ids.camera });
        const bySlug = await shopClient.query(SHOP_GET_PRODUCT, { slug: 'camera' });
        const { products } = await shopClient.query(SHOP_GET_PRODUCTS, { options: { take: 100 } });
        const { collection } = await shopClient.query(SHOP_COLLECTION_VARIANTS, { slug: 'electronics' });
        const { search } = await shopClient.query(SHOP_SEARCH, { input: { groupByProduct: true, take: 100 } });
        return {
            detail: !!product,
            bySlug: !!bySlug.product,
            inList: products.items.some((p: any) => p.id === ids.camera),
            listTotal: products.totalItems,
            inCollection: collection.productVariants.items.some((v: any) => v.id === ids.cameraVariant),
            inSearch: search.items.some((i: any) => i.productId === ids.camera),
            searchTotal: search.totalItems,
        };
    }

    async function canPurchase(token: string) {
        // a fresh guest session per attempt
        await shopClient.asAnonymousUser();
        shopClient.setChannelToken(token);
        try {
            const { addItemToOrder } = await shopClient.query(ADD_ITEM_TO_ORDER, {
                productVariantId: ids.cameraVariant,
                quantity: 1,
            });
            return addItemToOrder.__typename === 'Order';
        } catch {
            return false;
        }
    }

    async function setOverride(channelId: string, enabled: boolean) {
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.camera, channelId, enabled } });
        await awaitRunningJobs(adminClient);
    }

    async function globalEnabled() {
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
        const { product } = await adminClient.query(ADMIN_GET_PRODUCT, { id: ids.camera });
        return product.enabled;
    }

    const visible = { detail: true, bySlug: true, inList: true, inCollection: true, inSearch: true };
    const hidden = { detail: false, bySlug: false, inList: false, inCollection: false, inSearch: false };

    it('baseline: no overrides behaves like core (5 products in both channels)', async () => {
        for (const token of [DEFAULT_CHANNEL_TOKEN, CHANNEL_B_TOKEN]) {
            const result = await discovery(token);
            expect(result).toMatchObject({ ...visible, listTotal: 5, searchTotal: 5 });
            expect(await canPurchase(token)).toBe(true);
        }
    });

    it('1. set global Product.enabled = false → hidden and unpurchasable everywhere', async () => {
        await adminClient.query(UPDATE_PRODUCT, { input: { id: ids.camera, enabled: false } });
        await awaitRunningJobs(adminClient);
        for (const token of [DEFAULT_CHANNEL_TOKEN, CHANNEL_B_TOKEN]) {
            expect(await discovery(token)).toMatchObject({ ...hidden, listTotal: 4, searchTotal: 4 });
            expect(await canPurchase(token)).toBe(false);
        }
    });

    it('2+3. explicitly enable in Channel A → discoverable and purchasable in A', async () => {
        await setOverride(channelA, true);
        expect(await discovery(DEFAULT_CHANNEL_TOKEN)).toMatchObject({ ...visible, listTotal: 5, searchTotal: 5 });
        expect(await canPurchase(DEFAULT_CHANNEL_TOKEN)).toBe(true);
        expect(await globalEnabled()).toBe(false);
    });

    it('4. remains unavailable in Channel B (no override)', async () => {
        expect(await discovery(CHANNEL_B_TOKEN)).toMatchObject({ ...hidden, listTotal: 4, searchTotal: 4 });
        expect(await canPurchase(CHANNEL_B_TOKEN)).toBe(false);
    });

    it('5. explicitly enable Channel B → available there', async () => {
        await setOverride(channelB, true);
        expect(await discovery(CHANNEL_B_TOKEN)).toMatchObject({ ...visible, listTotal: 5, searchTotal: 5 });
        expect(await canPurchase(CHANNEL_B_TOKEN)).toBe(true);
    });

    it('6. disable Channel A → A hidden, B unaffected', async () => {
        await setOverride(channelA, false);
        expect(await discovery(DEFAULT_CHANNEL_TOKEN)).toMatchObject({ ...hidden, listTotal: 4, searchTotal: 4 });
        expect(await canPurchase(DEFAULT_CHANNEL_TOKEN)).toBe(false);
        expect(await discovery(CHANNEL_B_TOKEN)).toMatchObject({ ...visible, listTotal: 5, searchTotal: 5 });
        expect(await canPurchase(CHANNEL_B_TOKEN)).toBe(true);
    });

    it('7. clear Channel B override → global fallback (disabled) returns', async () => {
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
        const { clearProductChannelAvailability } = await adminClient.query(CLEAR_AVAILABILITY, {
            input: { productId: ids.camera, channelId: channelB },
        });
        expect(clearProductChannelAvailability).toMatchObject({
            overrideState: 'INHERITED',
            override: null,
            globalEnabled: false,
            effectiveEnabled: false,
        });
        await awaitRunningJobs(adminClient);
        expect(await discovery(CHANNEL_B_TOKEN)).toMatchObject({ ...hidden, listTotal: 4, searchTotal: 4 });
        expect(await canPurchase(CHANNEL_B_TOKEN)).toBe(false);
    });

    it('global flag was never modified by any override operation', async () => {
        expect(await globalEnabled()).toBe(false);
    });

    it('re-enabling globally restores B (no override) but A stays explicitly disabled', async () => {
        await adminClient.query(UPDATE_PRODUCT, { input: { id: ids.camera, enabled: true } });
        await awaitRunningJobs(adminClient);
        expect(await discovery(CHANNEL_B_TOKEN)).toMatchObject(visible);
        expect(await discovery(DEFAULT_CHANNEL_TOKEN)).toMatchObject(hidden);
        expect(await canPurchase(DEFAULT_CHANNEL_TOKEN)).toBe(false);
    });
});

