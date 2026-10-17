import { DefaultSearchPlugin, mergeConfig, VendureConfig } from '@vendure/core';
import {
    createTestEnvironment,
    PostgresInitializer,
    registerInitializer,
    SimpleGraphQLClient,
    SqljsInitializer,
    testConfig,
} from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';

import { ChannelProductAvailabilityPlugin, ChannelProductAvailabilityPluginOptions } from '../../src';
import { testPaymentHandler } from '../fixtures/test-payment-handler';

/**
 * TEST_DB=postgres runs against a real Postgres server using PGHOST, PGPORT,
 * PGUSER and PGPASSWORD (a database is created per test file). Otherwise an
 * in-memory sqljs database is used.
 */
export const TEST_DB = process.env.TEST_DB === 'postgres' ? 'postgres' : 'sqljs';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '../__data__')));
registerInitializer('postgres', new PostgresInitializer());

export function createAvailabilityTestEnvironment(
    options: ChannelProductAvailabilityPluginOptions = {},
    extra: Partial<VendureConfig> = {},
) {
    const dbConnectionOptions =
        TEST_DB === 'postgres'
            ? {
                  type: 'postgres' as const,
                  host: process.env.PGHOST ?? 'localhost',
                  port: Number(process.env.PGPORT ?? 5432),
                  username: process.env.PGUSER ?? 'postgres',
                  password: process.env.PGPASSWORD ?? '',
                  synchronize: true,
              }
            : {};
    // `testConfig` is an object in <=3.7 and a function of the port in later releases.
    const baseConfig: VendureConfig =
        typeof testConfig === 'function' ? (testConfig as any)(3050) : (testConfig as VendureConfig);
    const config = mergeConfig(baseConfig, {
        apiOptions: { port: 3050 },
        dbConnectionOptions,
        paymentOptions: { paymentMethodHandlers: [testPaymentHandler] },
        plugins: [DefaultSearchPlugin.init({ bufferUpdates: false }), ChannelProductAvailabilityPlugin.init(options)],
        ...extra,
    } as any);
    return createTestEnvironment(config as Required<VendureConfig>);
}

const GET_UNSETTLED_JOBS = gql`
    query GetUnsettledJobs {
        jobs(options: { filter: { isSettled: { eq: false } } }) {
            totalItems
        }
    }
`;

/** Waits until the job queue (search indexing, collection filters) is idle. */
export async function awaitRunningJobs(adminClient: SimpleGraphQLClient, timeoutMs = 10_000) {
    const start = Date.now();
    // give freshly published events a moment to enqueue their jobs
    await new Promise(r => setTimeout(r, 100));
    while (Date.now() - start < timeoutMs) {
        const { jobs } = await adminClient.query(GET_UNSETTLED_JOBS);
        if (jobs.totalItems === 0) {
            return;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Jobs still running after ${timeoutMs}ms`);
}
