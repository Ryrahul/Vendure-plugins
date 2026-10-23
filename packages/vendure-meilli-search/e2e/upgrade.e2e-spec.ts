import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { awaitRunningJobs, createMeiliTestEnvironment, deleteIndexes, meiliClient, serverInitOptions } from './utils/test-environment';

const PREFIX = 'e2e-upgrade-';
const INDEX = `${PREFIX}variants`;

/** The settings 2.x left on an index: plain filterable list without the asset ids, alphabetical facets. */
const V2_FILTERABLE = [
    'channelId', 'languageCode', 'facetValueIds', 'collectionIds', 'collectionSlugs', 'enabled', 'productEnabled',
    'productId', 'sku', 'inStock', 'productInStock', 'price', 'priceWithTax', 'productPriceMin', 'productPriceMax',
    'productPriceWithTaxMin', 'productPriceWithTaxMax', 'productFacetIds', 'productFacetValueIds',
    'productCollectionIds', 'productCollectionSlugs', 'productChannelIds', 'channelIds',
];

async function waitForAllTasks() {
    const client = meiliClient();
    const { results } = await client.tasks.getTasks({ indexUids: [INDEX], statuses: ['enqueued', 'processing'] });
    for (const task of results) {
        await client.tasks.waitForTask(task.uid);
    }
}

describe('upgrading an index created by 2.x', () => {
    const { server, adminClient, shopClient } = createMeiliTestEnvironment(PREFIX);

    beforeAll(async () => {
        await deleteIndexes(PREFIX);
        const client = meiliClient();
        await client.tasks.waitForTask((await client.createIndex(INDEX, { primaryKey: 'id' })).taskUid);
        await client.tasks.waitForTask(
            (await client.index(INDEX).updateSettings({ filterableAttributes: V2_FILTERABLE, synonyms: { old: ['stale'] } })).taskUid,
        );
        // Bootstrap must sync the settings of the existing index (in the background)
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        await waitForAllTasks();
    });

    afterAll(async () => {
        await server.destroy();
        await deleteIndexes(PREFIX);
    });

    it('syncs the settings of the existing index at startup', async () => {
        const settings = await meiliClient().index(INDEX).getSettings();
        expect(JSON.stringify(settings.filterableAttributes)).toContain('productAssetId');
        expect(settings.synonyms).toEqual({});
        expect(settings.faceting?.sortFacetValuesBy).toEqual({ '*': 'count' });
        const { results } = await meiliClient().tasks.getTasks({ indexUids: [INDEX], types: ['settingsUpdate'] });
        expect(results.every(t => t.status === 'succeeded')).toBe(true);
    });

    it('reindexes after the upgrade and applies asset updates', async () => {
        // The test database is cached between runs, so don't rely on import events: reindex
        await adminClient.query(gql`mutation { reindex { id } }`);
        await awaitRunningJobs(adminClient);
        const SEARCH = gql`
            query ($input: SearchInput!) {
                search(input: $input) {
                    totalItems
                    items { productAsset { id focalPoint { x y } } }
                }
            }
        `;
        const { search } = await shopClient.query(SEARCH, { input: { term: 'camera', groupByProduct: true } });
        expect(search.totalItems).toBe(1);
        await adminClient.query(
            gql`mutation ($id: ID!) { updateAsset(input: { id: $id, focalPoint: { x: 0.1, y: 0.2 } }) { id } }`,
            { id: search.items[0].productAsset.id },
        );
        await awaitRunningJobs(adminClient);
        const after = await shopClient.query(SEARCH, { input: { term: 'camera', groupByProduct: true } });
        expect(after.search.items[0].productAsset.focalPoint).toEqual({ x: 0.1, y: 0.2 });
    });

    it('sends no settings again on the next start', async () => {
        const before = await meiliClient().tasks.getTasks({ indexUids: [INDEX], types: ['settingsUpdate'] });
        await server.destroy();
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        await waitForAllTasks();
        const after = await meiliClient().tasks.getTasks({ indexUids: [INDEX], types: ['settingsUpdate'] });
        expect(after.results.length).toBe(before.results.length);
    });
});
