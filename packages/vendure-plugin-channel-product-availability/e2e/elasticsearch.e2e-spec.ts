import { Client } from '@elastic/elasticsearch';
import * as esPlugin from '@vendure-community/elasticsearch-plugin';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ChannelProductAvailabilityPlugin } from '../src';
import { ChannelAvailabilityElasticsearchPlugin, CHANNEL_ENABLED_FIELD, withChannelAvailability } from '../src/elasticsearch';
import { CLEAR_AVAILABILITY, SET_AVAILABILITY, UPDATE_PRODUCT, UPDATE_VARIANTS } from './graphql';
import { CHANNEL_B_TOKEN, DEFAULT_CHANNEL_TOKEN, ids, serverInitOptions, setupChannels } from './utils/setup';
import { awaitRunningJobs, createAvailabilityTestEnvironment } from './utils/test-environment';

/**
 * Against a real Elasticsearch, e.g.
 *   docker run -d -p 9209:9200 -e discovery.type=single-node -e xpack.security.enabled=false \
 *     docker.elastic.co/elasticsearch/elasticsearch:9.1.5
 *   ELASTICSEARCH_PORT=9209 npx vitest run e2e/elasticsearch.e2e-spec.ts
 */
const ES_PORT = process.env.ELASTICSEARCH_PORT;
const ES_HOST = process.env.ELASTICSEARCH_HOST ?? 'http://localhost';
const INDEX_PREFIX = 'plca-e2e-';

/** ES plugin 2.x connects through an adapter; 1.x takes host and port. */
function connectionOptions(): any {
    const create = (esPlugin as any).createElasticsearchAdapter;
    return typeof create === 'function'
        ? { adapter: () => create({ host: ES_HOST, port: Number(ES_PORT) }) }
        : { host: ES_HOST, port: Number(ES_PORT) };
}

const SEARCH = gql`
    query ($input: SearchInput!) {
        search(input: $input) {
            totalItems
            items {
                productId
                productName
            }
            facetValues {
                count
                facetValue {
                    name
                }
            }
        }
    }
`;

describe.skipIf(!ES_PORT)('Elasticsearch adapter', () => {
    const { server, adminClient, shopClient } = createAvailabilityTestEnvironment(
        { syncDefaultSearchIndex: false },
        {
            plugins: [
                esPlugin.ElasticsearchPlugin.init(withChannelAvailability({ ...connectionOptions(), indexPrefix: INDEX_PREFIX })),
                ChannelProductAvailabilityPlugin.init({ syncDefaultSearchIndex: false }),
                ChannelAvailabilityElasticsearchPlugin,
            ],
        },
    );
    const es = new Client({ node: `${ES_HOST}:${ES_PORT}` });
    let channelA: string;
    let channelB: string;

    /** Search results settle after the index job and an Elasticsearch refresh. */
    async function search(token: string, input: Record<string, unknown>, api: 'shop' | 'admin' = 'shop') {
        await awaitRunningJobs(adminClient);
        await es.indices.refresh({ index: `${INDEX_PREFIX}*` });
        const client = api === 'shop' ? shopClient : adminClient;
        client.setChannelToken(token);
        const { search: result } = await client.query(SEARCH, { input });
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
        return result;
    }
    const finds = async (token: string, groupByProduct: boolean, productId = ids.camera, term = 'camera') =>
        (await search(token, { term, groupByProduct })).items.some((i: any) => i.productId === productId);
    const electronics = (result: any) => result.facetValues.find((f: any) => f.facetValue.name === 'electronics')?.count ?? 0;

    beforeAll(async () => {
        const existing = await es.indices.get({ index: `${INDEX_PREFIX}*` }).catch(() => ({}));
        for (const name of Object.keys(existing)) {
            await es.indices.delete({ index: name });
        }
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        ({ channelA, channelB } = await setupChannels(adminClient));
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(gql`mutation { reindex { id } }`);
        await awaitRunningJobs(adminClient);
    });

    afterAll(async () => {
        await server.destroy();
    });

    it('1. finds the product in both channels', async () => {
        for (const group of [false, true]) {
            expect(await finds(DEFAULT_CHANNEL_TOKEN, group)).toBe(true);
            expect(await finds(CHANNEL_B_TOKEN, group)).toBe(true);
        }
        const doc = await es.search({ index: `${INDEX_PREFIX}variants`, query: { term: { productId: 2 } }, size: 10 });
        const hits = doc.hits.hits.map((h: any) => h._source);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every((h: any) => h[CHANNEL_ENABLED_FIELD] === true)).toBe(true);
    });

    it('2. switched OFF in A: not found in A (totals and facets drop), still found in B', async () => {
        const beforeVariants = await search(DEFAULT_CHANNEL_TOKEN, { groupByProduct: false });
        const beforeProducts = await search(DEFAULT_CHANNEL_TOKEN, { groupByProduct: true });

        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.camera, channelId: channelA, enabled: false } });

        for (const group of [false, true]) {
            expect(await finds(DEFAULT_CHANNEL_TOKEN, group)).toBe(false);
            expect(await finds(CHANNEL_B_TOKEN, group)).toBe(true);
        }
        const afterVariants = await search(DEFAULT_CHANNEL_TOKEN, { groupByProduct: false });
        const afterProducts = await search(DEFAULT_CHANNEL_TOKEN, { groupByProduct: true });
        // the camera has one variant
        expect(afterVariants.totalItems).toBe(beforeVariants.totalItems - 1);
        expect(afterProducts.totalItems).toBe(beforeProducts.totalItems - 1);
        expect(electronics(afterVariants)).toBe(electronics(beforeVariants) - 1);
        expect(electronics(afterProducts)).toBe(electronics(beforeProducts) - 1);
        // channel B unchanged
        expect((await search(CHANNEL_B_TOKEN, { groupByProduct: true })).totalItems).toBe(beforeProducts.totalItems);
    });

    it('7. admin search (enabledOnly = false) is unchanged', async () => {
        const result = await search(DEFAULT_CHANNEL_TOKEN, { term: 'camera', groupByProduct: true }, 'admin');
        expect(result.items.some((i: any) => i.productId === ids.camera)).toBe(true);
    });

    it('3. cleared: found in A again', async () => {
        await adminClient.query(CLEAR_AVAILABILITY, { input: { productId: ids.camera, channelId: channelA } });
        for (const group of [false, true]) {
            expect(await finds(DEFAULT_CHANNEL_TOKEN, group)).toBe(true);
            expect(await finds(CHANNEL_B_TOKEN, group)).toBe(true);
        }
    });

    it('4. globally disabled, ON in A: found in A, not in B', async () => {
        await adminClient.query(UPDATE_PRODUCT, { input: { id: ids.camera, enabled: false } });
        for (const group of [false, true]) {
            expect(await finds(DEFAULT_CHANNEL_TOKEN, group)).toBe(false);
            expect(await finds(CHANNEL_B_TOKEN, group)).toBe(false);
        }
        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.camera, channelId: channelA, enabled: true } });
        for (const group of [false, true]) {
            expect(await finds(DEFAULT_CHANNEL_TOKEN, group)).toBe(true);
            expect(await finds(CHANNEL_B_TOKEN, group)).toBe(false);
        }
    });

    it('4b. globally disabled, ON in A: a disabled variant stays hidden', async () => {
        await adminClient.query(UPDATE_VARIANTS, { input: [{ id: ids.laptop15, enabled: false }] });
        await adminClient.query(UPDATE_PRODUCT, { input: { id: ids.laptop, enabled: false } });
        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.laptop, channelId: channelA, enabled: true } });
        const result = await search(DEFAULT_CHANNEL_TOKEN, { term: 'laptop', groupByProduct: false });
        const skus = (await es.search({ index: `${INDEX_PREFIX}variants`, query: { term: { productId: 1 } }, size: 20 })).hits.hits
            .map((h: any) => h._source)
            .filter((d: any) => String(d.channelId) === String(channelA).replace('T_', ''))
            .map((d: any) => [d.sku, d[CHANNEL_ENABLED_FIELD]]);
        expect(skus.sort()).toEqual([
            ['L13', true],
            ['L15', false],
        ]);
        expect(result.items.filter((i: any) => i.productId === ids.laptop)).toHaveLength(1);
        expect(await finds(CHANNEL_B_TOKEN, false, ids.laptop, 'laptop')).toBe(false);
    });

    it('6. rollout: documents without the field fall back to `enabled`', async () => {
        const index = `${INDEX_PREFIX}variants`;
        // a document of channel A (the default channel), English
        const template: any = (
            await es.search({
                index,
                query: { bool: { filter: [{ term: { productId: 1 } }, { term: { channelId: 1 } }, { term: { languageCode: 'en' } }] } },
                size: 1,
            })
        ).hits.hits[0]._source;
        const legacy = (id: string, enabled: boolean) => {
            const doc = { ...template, productName: `Legacy ${id}`, productVariantName: `Legacy ${id}`, sku: id, enabled };
            delete doc[CHANNEL_ENABLED_FIELD];
            return es.index({ index, id: `legacy-${id}`, document: doc });
        };
        await legacy('visible', true);
        await legacy('hidden', false);
        const result = await search(DEFAULT_CHANNEL_TOKEN, { term: 'Legacy', groupByProduct: false });
        const names = result.items.map((i: any) => i.productName);
        expect(names).toContain('Legacy visible');
        expect(names).not.toContain('Legacy hidden');
        await es.delete({ index, id: 'legacy-visible' });
        await es.delete({ index, id: 'legacy-hidden' });
    });

    it('reindexes once per product when several channels change at once', async () => {
        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.tablet, channelId: channelA, enabled: false } });
        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.tablet, channelId: channelB, enabled: false } });
        expect(await finds(DEFAULT_CHANNEL_TOKEN, true, ids.tablet, 'tablet')).toBe(false);
        expect(await finds(CHANNEL_B_TOKEN, true, ids.tablet, 'tablet')).toBe(false);
    });
});
