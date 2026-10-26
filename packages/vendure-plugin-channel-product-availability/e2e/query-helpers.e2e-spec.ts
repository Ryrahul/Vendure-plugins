import {
    ChannelService,
    ID,
    ListQueryBuilder,
    ProductVariant,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ChannelProductAvailabilityService, enforceGuardFilter } from '../src';
import { DELETE_PRODUCT, SET_AVAILABILITY, UPDATE_PRODUCT, UPDATE_VARIANTS } from './graphql';
import { DEFAULT_CHANNEL_TOKEN, ids, serverInitOptions, setupChannels } from './utils/setup';
import { createAvailabilityTestEnvironment } from './utils/test-environment';

/**
 * Scenario from the handoff:
 * - P (camera): switched OFF in channel A only
 * - Q (phone): globally disabled, switched ON in channel A only
 * - R (tablet): normal
 * - the laptop has one disabled variant; the headphones product is deleted
 *
 * Database ids (TestingEntityIdStrategy encodes 2 as "T_2"):
 *   products: laptop 1, camera 2, phone 3, tablet 4, headphones 5
 *   variants: laptop13 1, laptop15 2, camera 3, phone 4, tablet 5, headphones 6
 */
describe('query helpers', () => {
    const { server, adminClient } = createAvailabilityTestEnvironment();
    let service: ChannelProductAvailabilityService;
    let ctxA: RequestContext;
    let ctxB: RequestContext;
    let channelBId: ID;

    beforeAll(async () => {
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        const { channelA, channelB } = await setupChannels(adminClient);
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);

        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.camera, channelId: channelA, enabled: false } });
        await adminClient.query(UPDATE_PRODUCT, { input: { id: ids.phone, enabled: false } });
        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.phone, channelId: channelA, enabled: true } });
        await adminClient.query(UPDATE_VARIANTS, { input: [{ id: ids.laptop15, enabled: false }] });
        await adminClient.query(DELETE_PRODUCT, { id: ids.headphones });

        service = server.app.get(ChannelProductAvailabilityService);
        const channelService = server.app.get(ChannelService);
        const requestContext = server.app.get(RequestContextService);
        const channels = await channelService.findAll(RequestContext.empty());
        const a = channels.items.find(c => c.token === DEFAULT_CHANNEL_TOKEN)!;
        const b = channels.items.find(c => c.code === 'channel-b')!;
        channelBId = b.id;
        ctxA = await requestContext.create({ apiType: 'shop', channelOrToken: a });
        ctxB = await requestContext.create({ apiType: 'shop', channelOrToken: b });
        expect(String(channelB)).toContain(String(b.id));
    });

    afterAll(async () => {
        await server.destroy();
    });

    const sorted = (list: ID[]) => list.map(Number).sort((x, y) => x - y);

    describe('filterAvailableVariantIds()', () => {
        it('keeps available variants in the input order (channel A: R and Q, not P)', async () => {
            expect(await service.filterAvailableVariantIds(ctxA, [5, 3, 4, 1])).toEqual([5, 4, 1]);
        });

        it('applies the other channel (channel B: R and P, not Q)', async () => {
            expect(await service.filterAvailableVariantIds(ctxB, [5, 3, 4, 1])).toEqual([5, 3, 1]);
            // explicit channelId instead of the context's channel
            expect(await service.filterAvailableVariantIds(ctxA, [5, 3, 4, 1], channelBId)).toEqual([5, 3, 1]);
        });

        it('drops disabled variants and variants of deleted products', async () => {
            expect(await service.filterAvailableVariantIds(ctxA, [2, 6, 1])).toEqual([1]);
        });

        it('keeps string ids as given, and duplicates', async () => {
            expect(await service.filterAvailableVariantIds(ctxA, ['5', '1', '5'])).toEqual(['5', '1', '5']);
        });

        it('returns [] for empty input', async () => {
            expect(await service.filterAvailableVariantIds(ctxA, [])).toEqual([]);
        });
    });

    describe('filterAvailableProductIds()', () => {
        it('applies the rule per channel, in input order', async () => {
            expect(await service.filterAvailableProductIds(ctxA, [4, 2, 3, 1])).toEqual([4, 3, 1]);
            expect(await service.filterAvailableProductIds(ctxB, [4, 2, 3, 1])).toEqual([4, 2, 1]);
        });

        it('drops deleted products', async () => {
            expect(await service.filterAvailableProductIds(ctxA, [5, 4])).toEqual([4]);
        });
    });

    describe('applyToQueryBuilder()', () => {
        const variantQuery = () =>
            server.app
                .get(TransactionalConnection)
                .getRepository(ctxA, ProductVariant)
                .createQueryBuilder('variant')
                .innerJoin('variant.product', 'product')
                .select('variant.id', 'id')
                .where('variant.deletedAt IS NULL')
                .andWhere('variant.enabled = :variantEnabled', { variantEnabled: true });

        it('restricts to available products per channel', async () => {
            const qbA = await service.applyToQueryBuilder(ctxA, variantQuery(), 'product');
            expect(sorted((await qbA.getRawMany()).map(r => r.id))).toEqual([1, 4, 5]);
            const qbB = await service.applyToQueryBuilder(ctxB, variantQuery(), 'product');
            expect(sorted((await qbB.getRawMany()).map(r => r.id))).toEqual([1, 3, 5]);
        });

        it('can be applied twice to one builder without parameter clashes', async () => {
            const qb = variantQuery().innerJoin('variant.product', 'product2');
            await service.applyToQueryBuilder(ctxA, qb, 'product');
            await service.applyToQueryBuilder(ctxB, qb, 'product2');
            // available in both A and B: laptop (1) and tablet (5)
            expect(sorted((await qb.getRawMany()).map(r => r.id))).toEqual([1, 5]);
        });

        it('never emits IN () when a channel has no overrides', async () => {
            const qb = await service.applyToQueryBuilder(ctxB, variantQuery(), 'product');
            expect(qb.getQuery()).not.toMatch(/IN\s*\(\s*\)/);
        });
    });

    describe('applyToVariantQueryBuilder()', () => {
        it('works on a ListQueryBuilder query and keeps totals right', async () => {
            const qb = server.app
                .get(ListQueryBuilder)
                .build(ProductVariant, { take: 10 }, { ctx: ctxA, channelId: ctxA.channelId });
            await service.applyToVariantQueryBuilder(ctxA, qb, qb.alias);
            const [items, totalItems] = await qb.getManyAndCount();
            expect(sorted(items.map(v => v.id))).toEqual([1, 4, 5]);
            expect(totalItems).toBe(3);
        });
    });

    describe('getAvailableProductIdsSubQuery()', () => {
        it('works in a QueryBuilder', async () => {
            const { sql, params } = await service.getAvailableProductIdsSubQuery(ctxB);
            const rows = await server.app
                .get(TransactionalConnection)
                .getRepository(ctxB, ProductVariant)
                .createQueryBuilder('variant')
                .select('variant.id', 'id')
                .where(`variant.productId IN (${sql})`, params)
                .getRawMany();
            // the subquery is about products: the disabled laptop variant (2) stays in
            expect(sorted(rows.map(r => r.id))).toEqual([1, 2, 3, 5]);
        });

        it('works in raw SQL via the driver', async () => {
            const connection = server.app.get(TransactionalConnection).rawConnection;
            const { sql, params } = await service.getAvailableProductIdsSubQuery(ctxA);
            const [query, values] = connection.driver.escapeQueryWithParameters(sql, params, {});
            const rows: Array<Record<string, any>> = await connection.query(query, values);
            expect(sorted(rows.map(r => Object.values(r)[0]))).toEqual([1, 3, 4]);
        });
    });

    describe('getEffectiveEnabledVariantFilter()', () => {
        it('works as a ListQueryBuilder filter combined with a user filter', async () => {
            const guard = await service.getEffectiveEnabledVariantFilter(ctxA);
            const options = enforceGuardFilter({ filter: { sku: { contains: '' } }, filterOperator: 'OR' as any, take: 10 }, guard);
            const [items, totalItems] = await server.app
                .get(ListQueryBuilder)
                .build(ProductVariant, options, { ctx: ctxA, channelId: ctxA.channelId })
                .getManyAndCount();
            expect(sorted(items.map(v => v.id))).toEqual([1, 4, 5]);
            expect(totalItems).toBe(3);
        });

        it('lists the effectively disabled products per channel', async () => {
            expect((await service.getEffectivelyDisabledProductIds(ctxA)).sort()).toEqual(['2']);
            expect((await service.getEffectivelyDisabledProductIds(ctxB)).sort()).toEqual(['3']);
        });
    });
});
