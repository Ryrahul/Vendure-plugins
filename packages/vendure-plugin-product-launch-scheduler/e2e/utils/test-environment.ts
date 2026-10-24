import { DefaultSchedulerPlugin, DefaultSearchPlugin, mergeConfig, VendureConfig } from '@vendure/core';
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
import { expect } from 'vitest';

import { ProductLaunchSchedulerOptions, ProductLaunchSchedulerPlugin } from '../../src';
import { formatLocalTime } from '../../src/time/zoned-time';
import { initialData } from '../fixtures/initial-data';

/**
 * TEST_DB=postgres runs against a real Postgres server using PGHOST, PGPORT, PGUSER and
 * PGPASSWORD (a database is created per test file). Otherwise an in-memory sqljs database is used.
 */
export const TEST_DB = process.env.TEST_DB === 'postgres' ? 'postgres' : 'sqljs';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '../__data__')));
registerInitializer('postgres', new PostgresInitializer());

export const PORT = 3080;

export function createSchedulerTestEnvironment(
    options: ProductLaunchSchedulerOptions = {},
    extra: Partial<VendureConfig> = {},
    { withScheduler = true }: { withScheduler?: boolean } = {},
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
        typeof testConfig === 'function' ? (testConfig as any)(PORT) : (testConfig as VendureConfig);
    const config = mergeConfig(baseConfig, {
        apiOptions: { port: PORT },
        dbConnectionOptions,
        // The test environment has no worker: let the server run scheduled tasks.
        schedulerOptions: { runTasksInWorkerOnly: false },
        plugins: [
            DefaultSearchPlugin.init({ bufferUpdates: false }),
            // check for manually triggered tasks (runScheduledTask) often, for the tests
            ...(withScheduler ? [DefaultSchedulerPlugin.init({ manualTriggerCheckInterval: 200 })] : []),
            ProductLaunchSchedulerPlugin.init(options),
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

/** Product ids from fixtures/products.csv (TestingEntityIdStrategy). */
export const ids = { laptop: 'T_1', camera: 'T_2', phone: 'T_3', tablet: 'T_4', headphones: 'T_5' };

/** The local time `minutes` from `from` in `timezone`, as YYYY-MM-DDTHH:mm. */
export function localIn(minutes: number, timezone = 'UTC', from = new Date()): string {
    return formatLocalTime(new Date(from.getTime() + minutes * 60_000), timezone);
}

/** `minutes` from now, as a Date. */
export function minutesFromNow(minutes: number): Date {
    return new Date(Date.now() + minutes * 60_000);
}

/** Asserts that a GraphQL call fails with the given `extensions.code`; returns the message. */
export async function expectErrorCode(promise: Promise<unknown>, code: string): Promise<string> {
    let error: any;
    try {
        await promise;
    } catch (e) {
        error = e;
    }
    expect(error, `expected error ${code}`).toBeDefined();
    const graphQLError = error.response?.errors?.[0];
    expect(graphQLError?.extensions?.code ?? error.message).toBe(code);
    return graphQLError.message;
}

const GET_UNSETTLED_JOBS = gql`
    query GetUnsettledJobs {
        jobs(options: { filter: { isSettled: { eq: false } } }) {
            totalItems
        }
    }
`;

/** Waits until the job queue (search indexing) is idle. */
export async function awaitRunningJobs(adminClient: SimpleGraphQLClient, timeoutMs = 10_000) {
    const start = Date.now();
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
