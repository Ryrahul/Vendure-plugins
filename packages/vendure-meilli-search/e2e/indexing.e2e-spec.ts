import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { awaitRunningJobs, createMeiliTestEnvironment, deleteIndexes, meiliClient, serverInitOptions } from './utils/test-environment';

const PREFIX = 'e2e-indexing-';

const SEARCH = gql`
    query Search($input: SearchInput!) {
        search(input: $input) {
            totalItems
            items {
                productId
                productName
                sku
                productAsset {
                    id
                    focalPoint {
                        x
                        y
                    }
                }
            }
            facetValues {
                count
                facetValue {
                    name
                }
            }
            collections {
                count
                collection {
                    name
                }
            }
        }
    }
`;

describe('Meilisearch indexing and search', () => {
    const { server, adminClient, shopClient } = createMeiliTestEnvironment(PREFIX);

    beforeAll(async () => {
        await deleteIndexes(PREFIX);
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        await adminClient.query(gql`mutation { reindex { id } }`);
        await awaitRunningJobs(adminClient);
    });

    afterAll(async () => {
        await server.destroy();
        await deleteIndexes(PREFIX);
    });

    it('finds products by keyword', async () => {
        const { search } = await shopClient.query(SEARCH, { input: { term: 'laptop', groupByProduct: true } });
        expect(search.items.map((i: any) => i.productName)).toEqual(['Laptop']);
    });

    it('counts products, facets and collections', async () => {
        const { search } = await shopClient.query(SEARCH, { input: { groupByProduct: true, take: 10 } });
        expect(search.totalItems).toBe(5);
        const electronics = search.facetValues.find((f: any) => f.facetValue.name === 'electronics');
        expect(electronics.count).toBe(4);
        expect(search.collections.find((c: any) => c.collection.name === 'Electronics').count).toBe(4);
    });

    it('applies a changed asset focal point to the search index', async () => {
        const before = await shopClient.query(SEARCH, { input: { term: 'laptop', groupByProduct: true } });
        const assetId = before.search.items[0].productAsset.id;
        await adminClient.query(gql`mutation($id: ID!) { updateAsset(input: { id: $id, focalPoint: { x: 0.25, y: 0.75 } }) { id } }`, {
            id: assetId,
        });
        await awaitRunningJobs(adminClient);
        const after = await shopClient.query(SEARCH, { input: { term: 'laptop', groupByProduct: true } });
        expect(after.search.items[0].productAsset.focalPoint).toEqual({ x: 0.25, y: 0.75 });
    });

    it('keeps a product searchable while it is being updated', async () => {
        const { products } = await adminClient.query(gql`{ products(options: { filter: { slug: { eq: "camera" } } }) { items { id } } }`);
        const id = products.items[0].id;
        await adminClient.query(gql`mutation($id: ID!) { updateProduct(input: { id: $id, translations: [{ languageCode: en, name: "Camera Pro" }] }) { id } }`, { id });
        // Poll while the index job runs: the product must never be missing.
        const missing: number[] = [];
        for (let i = 0; i < 30; i++) {
            const { search } = await shopClient.query(SEARCH, { input: { term: 'camera', groupByProduct: true } });
            if (!search.items.length) missing.push(i);
            await new Promise(r => setTimeout(r, 20));
        }
        await awaitRunningJobs(adminClient);
        const { search } = await shopClient.query(SEARCH, { input: { term: 'camera', groupByProduct: true } });
        expect(search.items[0].productName).toBe('Camera Pro');
        expect(missing).toEqual([]);
    });

    it('counts variants when not grouped', async () => {
        const { search } = await shopClient.query(SEARCH, { input: { take: 10 } });
        expect(search.totalItems).toBe(6);
        expect(search.facetValues.find((f: any) => f.facetValue.name === 'electronics').count).toBe(5);
        expect(search.collections.find((c: any) => c.collection.name === 'Electronics').count).toBe(5);
    });

    it('counts SKUs with groupBySKU', async () => {
        const { search } = await shopClient.query(SEARCH, { input: { groupBySKU: true, take: 10 } });
        expect(search.totalItems).toBe(6);
        expect(search.facetValues.find((f: any) => f.facetValue.name === 'electronics').count).toBe(5);
        expect(search.facetValues.find((f: any) => f.facetValue.name === 'audio').count).toBe(1);
    });

    it('orders facet values by count', async () => {
        const { search } = await shopClient.query(SEARCH, { input: { groupByProduct: true } });
        expect(search.facetValues.map((f: any) => f.facetValue.name)).toEqual(['electronics', 'audio']);
    });

    it('returns price buckets', async () => {
        const { search } = await shopClient.query(
            gql`
                query {
                    search(input: { groupByProduct: true }) {
                        prices {
                            range {
                                min
                                max
                            }
                            buckets {
                                to
                                count
                            }
                        }
                    }
                }
            `,
        );
        expect(search.prices.range).toEqual({ min: 9900, max: 139900 });
        // Default bucket interval 1000 (minor units): one bucket per distinct price here
        expect(search.prices.buckets.reduce((sum: number, b: any) => sum + b.count, 0)).toBe(6);
        expect(search.prices.buckets[0]).toEqual({ to: 10000, count: 1 });
    });

    it('removes the documents of a deleted variant', async () => {
        const { search: before } = await adminClient.query(SEARCH, { input: { term: 'laptop' } });
        expect(before.items.map((i: any) => i.sku).sort()).toEqual(['L13', 'L15']);
        const { productVariants } = await adminClient.query(
            gql`{ productVariants(options: { filter: { sku: { eq: "L15" } } }) { items { id } } }`,
        );
        await adminClient.query(gql`mutation($ids: [ID!]!) { deleteProductVariants(ids: $ids) { result } }`, {
            ids: [productVariants.items[0].id],
        });
        await awaitRunningJobs(adminClient);
        const { search: after } = await adminClient.query(SEARCH, { input: { term: 'laptop' } });
        expect(after.items.map((i: any) => i.sku)).toEqual(['L13']);
    });

    it('removes the documents of a deleted product', async () => {
        const { products } = await adminClient.query(gql`{ products(options: { filter: { slug: { eq: "tablet" } } }) { items { id } } }`);
        await adminClient.query(gql`mutation($id: ID!) { deleteProduct(id: $id) { result } }`, { id: products.items[0].id });
        await awaitRunningJobs(adminClient);
        const { results } = await meiliClient()
            .index(`${PREFIX}variants`)
            .getDocuments({ filter: `productId = "${products.items[0].id as string}"` });
        expect(results).toEqual([]);
    });

    it('configures the index with a single settings task', async () => {
        const { results } = await meiliClient().tasks.getTasks({
            indexUids: [`${PREFIX}variants`],
            types: ['settingsUpdate'],
            limit: 100,
        });
        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('succeeded');
    });
});
