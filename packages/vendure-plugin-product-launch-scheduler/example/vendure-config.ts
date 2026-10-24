/**
 * A minimal Vendure app using the plugin, for trying it out and for checking the dashboard and
 * the migration against a real database. Not published.
 *
 *   docker run -d -p 5434:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
 *   npx ts-node example/populate.ts && npx ts-node example/index.ts
 */
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import {
    DefaultJobQueuePlugin,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    dummyPaymentHandler,
    VendureConfig,
} from '@vendure/core';
import path from 'path';

import { ProductLaunchSchedulerMigration1792800000000, ProductLaunchSchedulerPlugin } from '../src';

export const config: VendureConfig = {
    apiOptions: { port: 3090, adminApiPath: 'admin-api', shopApiPath: 'shop-api' },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: { identifier: 'superadmin', password: 'superadmin' },
        cookieOptions: { secret: 'example' },
    },
    dbConnectionOptions: {
        type: 'postgres',
        // The plugin's tables come from its migration; core tables from `synchronize` in populate.ts.
        synchronize: false,
        migrations: [ProductLaunchSchedulerMigration1792800000000],
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5434),
        username: process.env.DB_USERNAME ?? 'postgres',
        password: process.env.DB_PASSWORD ?? 'postgres',
        database: process.env.DB_NAME ?? 'launch_example',
    },
    paymentOptions: { paymentMethodHandlers: [dummyPaymentHandler] },
    schedulerOptions: { runTasksInWorkerOnly: false },
    plugins: [
        DefaultJobQueuePlugin.init({}),
        DefaultSearchPlugin.init({ bufferUpdates: false }),
        DefaultSchedulerPlugin.init(),
        ProductLaunchSchedulerPlugin.init({ pollSchedule: '*/10 * * * * *' }),
        DashboardPlugin.init({ route: 'dashboard', appDir: path.join(__dirname, 'dist/dashboard') }),
    ],
};
