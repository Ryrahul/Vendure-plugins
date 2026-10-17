import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    SET_AVAILABILITY,
    SHOP_COLLECTION_VARIANTS,
    SHOP_GET_PRODUCTS,
    SHOP_SEARCH,
    UPDATE_PRODUCT,
    UPDATE_VARIANTS,
} from './graphql';
import { CHANNEL_B_TOKEN, DEFAULT_CHANNEL_TOKEN, ids, serverInitOptions, setupChannels } from './utils/setup';
import { awaitRunningJobs, createAvailabilityTestEnvironment } from './utils/test-environment';

describe('catalog and search enforcement', () => {
    const { server, adminClient, shopClient } = createAvailabilityTestEnvironment();
    let channelA: string;

    beforeAll(async () => {
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        ({ channelA } = await setupChannels(adminClient));
        // Tablet: globally enabled, explicitly disabled in A.
        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.tablet, channelId: channelA, enabled: false } });
        // Laptop: globally disabled, explicitly enabled in A, 15" variant disabled.
        await adminClient.query(UPDATE_PRODUCT, { input: { id: ids.laptop, enabled: false } });
        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.laptop, channelId: channelA, enabled: true } });
        await adminClient.query(UPDATE_VARIANTS, { input: [{ id: ids.laptop15, enabled: false }] });
        await awaitRunningJobs(adminClient);
    });

    afterAll(async () => {
        await server.destroy();
    });

    describe('products list', () => {
        it('applies the rule in SQL so totalItems is correct', async () => {
            shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const { products } = await shopClient.query(SHOP_GET_PRODUCTS, { options: { take: 100 } });
            const slugs = products.items.map((p: any) => p.slug).sort();
            expect(slugs).toEqual(['camera', 'headphones', 'laptop', 'phone']);
            expect(products.totalItems).toBe(4);
        });

        it('paginates over the filtered set without gaps or duplicates', async () => {
            shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const seen: string[] = [];
            for (let skip = 0; skip < 4; skip += 1) {
                const { products } = await shopClient.query(SHOP_GET_PRODUCTS, {
                    options: { take: 1, skip, sort: { id: 'ASC' } },
                });
                expect(products.totalItems).toBe(4);
                seen.push(products.items[0].slug);
            }
            expect(seen).toEqual(['laptop', 'camera', 'phone', 'headphones']);
        });

        it('respects user filters combined with the guard', async () => {
            shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const { products } = await shopClient.query(SHOP_GET_PRODUCTS, {
                options: { filter: { slug: { in: ['tablet', 'laptop'] } } },
            });
            expect(products.items.map((p: any) => p.slug)).toEqual(['laptop']);
        });

        it('cannot be bypassed with filterOperator OR', async () => {
            shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const { products } = await shopClient.query(SHOP_GET_PRODUCTS, {
                options: { filter: { slug: { eq: 'tablet' }, enabled: { eq: false } }, filterOperator: 'OR' },
            });
            expect(products.items.map((p: any) => p.slug)).not.toContain('tablet');
        });

        it('channel B is unaffected (laptop globally disabled, tablet enabled)', async () => {
            shopClient.setChannelToken(CHANNEL_B_TOKEN);
            const { products } = await shopClient.query(SHOP_GET_PRODUCTS, { options: { take: 100 } });
            expect(products.items.map((p: any) => p.slug).sort()).toEqual(['camera', 'headphones', 'phone', 'tablet']);
        });
    });

    describe('collection variants', () => {
        it('lists override-enabled products, hides override-disabled ones and disabled variants', async () => {
            shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const { collection } = await shopClient.query(SHOP_COLLECTION_VARIANTS, { slug: 'electronics' });
            const variantIds = collection.productVariants.items.map((v: any) => v.id).sort();
            // laptop13, camera, phone — not laptop15 (variant disabled), not tablet (override disabled)
            expect(variantIds).toEqual([ids.laptop13, ids.cameraVariant, ids.phoneVariant].sort());
            expect(collection.productVariants.totalItems).toBe(3);
        });

        it('keeps the user filter working', async () => {
            shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const { collection } = await shopClient.query(SHOP_COLLECTION_VARIANTS, {
                slug: 'electronics',
                options: { filter: { sku: { eq: 'C001' } } },
            });
            expect(collection.productVariants.items.map((v: any) => v.id)).toEqual([ids.cameraVariant]);
        });
    });

    describe('search', () => {
        it('grouped results and totals follow the rule', async () => {
            shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const { search } = await shopClient.query(SHOP_SEARCH, { input: { groupByProduct: true, take: 100 } });
            expect(search.items.map((i: any) => i.productId).sort()).toEqual(
                [ids.laptop, ids.camera, ids.phone, ids.headphones].sort(),
            );
            expect(search.totalItems).toBe(4);
        });

        it('variant-level results respect variant.enabled under an enabling override', async () => {
            shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const { search } = await shopClient.query(SHOP_SEARCH, { input: { term: 'laptop', take: 100 } });
            expect(search.items.map((i: any) => i.productVariantId)).toEqual([ids.laptop13]);
        });

        it('search pagination is consistent with totals', async () => {
            shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const ids_: string[] = [];
            for (let skip = 0; skip < 4; skip += 2) {
                const { search } = await shopClient.query(SHOP_SEARCH, {
                    input: { groupByProduct: true, take: 2, skip, sort: { name: 'ASC' } },
                });
                expect(search.totalItems).toBe(4);
                ids_.push(...search.items.map((i: any) => i.productId));
            }
            expect(new Set(ids_).size).toBe(4);
        });

        it('survives a reindex of the product (index-write subscriber)', async () => {
            // Any product update triggers a core reindex of that product.
            await adminClient.query(UPDATE_PRODUCT, { input: { id: ids.tablet, translations: [{ languageCode: 'en', name: 'Tablet 2' }] } });
            await adminClient.query(UPDATE_PRODUCT, { input: { id: ids.laptop, translations: [{ languageCode: 'en', name: 'Laptop 2' }] } });
            await awaitRunningJobs(adminClient);
            shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
            const { search } = await shopClient.query(SHOP_SEARCH, { input: { groupByProduct: true, take: 100 } });
            const productIds = search.items.map((i: any) => i.productId);
            expect(productIds).toContain(ids.laptop);
            expect(productIds).not.toContain(ids.tablet);
        });

        it('channel B search is unaffected', async () => {
            shopClient.setChannelToken(CHANNEL_B_TOKEN);
            const { search } = await shopClient.query(SHOP_SEARCH, { input: { groupByProduct: true, take: 100 } });
            expect(search.items.map((i: any) => i.productId).sort()).toEqual(
                [ids.camera, ids.phone, ids.tablet, ids.headphones].sort(),
            );
        });
    });
});
