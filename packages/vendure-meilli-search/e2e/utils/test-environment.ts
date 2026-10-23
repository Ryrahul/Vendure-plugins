import { mergeConfig, VendureConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SimpleGraphQLClient, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import { Meilisearch } from 'meilisearch';
import path from 'path';

import { MeilisearchPlugin } from '../../src';
import { initialData } from '../fixtures/initial-data';
import { MeilisearchOptions } from '../../src/options';

/**
 * The e2e tests run against a real Meilisearch server:
 *   docker run -d -p 7701:7700 -e MEILI_MASTER_KEY=test-master-key getmeili/meilisearch:v1.55
 * Override with MEILI_HOST / MEILI_MASTER_KEY.
 */
export const MEILI_HOST = process.env.MEILI_HOST ?? 'http://localhost:7701';
export const MEILI_KEY = process.env.MEILI_MASTER_KEY ?? 'test-master-key';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '../__data__')));

export const PORT = 3070;

export function meiliClient() {
    return new Meilisearch({ host: MEILI_HOST, apiKey: MEILI_KEY });
}

/** A Vendure test server using the Meilisearch plugin with its own index prefix. */
export function createMeiliTestEnvironment(indexPrefix: string, options: Partial<MeilisearchOptions> = {}, extra: Partial<VendureConfig> = {}) {
    // `testConfig` is an object in <=3.7 and a function of the port in later releases.
    const baseConfig: VendureConfig = typeof testConfig === 'function' ? (testConfig as any)(PORT) : (testConfig as VendureConfig);
    const config = mergeConfig(baseConfig, {
        apiOptions: { port: PORT },
        importExportOptions: { importAssetsDir: path.join(__dirname, '../fixtures/assets') },
        plugins: [
            MeilisearchPlugin.init({
                host: MEILI_HOST,
                apiKey: MEILI_KEY,
                indexPrefix,
                bufferUpdates: false,
                ...options,
            }),
        ],
        ...extra,
    } as any);
    return createTestEnvironment(config as Required<VendureConfig>);
}

export const serverInitOptions = {
    initialData,
    productsCsvPath: path.join(__dirname, '../fixtures/products.csv'),
    customerCount: 1,
};

/** Deletes every index whose uid starts with the prefix (cleanup between runs). */
export async function deleteIndexes(prefix: string) {
    const client = meiliClient();
    const { results } = await client.getIndexes({ limit: 1000 });
    for (const index of results.filter(i => i.uid.startsWith(prefix))) {
        const task = await client.deleteIndex(index.uid);
        await client.tasks.waitForTask(task.taskUid);
    }
}

const GET_UNSETTLED_JOBS = gql`
    query GetUnsettledJobs {
        jobs(options: { filter: { isSettled: { eq: false } } }) {
            totalItems
        }
    }
`;

/** Waits until the job queue (search indexing, collection filters) is idle. */
export async function awaitRunningJobs(adminClient: SimpleGraphQLClient, timeoutMs = 30_000) {
    const start = Date.now();
    await new Promise(r => setTimeout(r, 150));
    while (Date.now() - start < timeoutMs) {
        const { jobs } = await adminClient.query(GET_UNSETTLED_JOBS);
        if (jobs.totalItems === 0) return;
        await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`Jobs still running after ${timeoutMs}ms`);
}
