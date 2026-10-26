/**
 * Minimal Vendure app using the plugin, used to check the dashboard and the migration against a
 * real database. Not published; typechecked with the package.
 *
 *   docker run -d -p 5436:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
 *   npx ts-node --transpile-only example/populate.ts && npx ts-node --transpile-only example/index.ts
 */
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import { DefaultJobQueuePlugin, DefaultSearchPlugin, dummyPaymentHandler, VendureConfig } from '@vendure/core';
import path from 'path';

import { ChannelProductAvailabilityMigration1792195200000, ChannelProductAvailabilityPlugin } from '../src';

export const config: VendureConfig = {
    apiOptions: { port: Number(process.env.PORT ?? 3093), adminApiPath: 'admin-api', shopApiPath: 'shop-api' },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: { identifier: 'superadmin', password: 'superadmin' },
        cookieOptions: { secret: 'example' },
    },
    dbConnectionOptions: {
        type: 'postgres',
        synchronize: false,
        // Either ship the plugin's migration…
        migrations: [ChannelProductAvailabilityMigration1792195200000, path.join(__dirname, 'migrations/*.+(js|ts)')],
        // …or generate your own with `npx vendure migrate` — not both.
        database: process.env.DB_NAME ?? 'availability_example',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5436),
        username: process.env.DB_USERNAME ?? 'postgres',
        password: process.env.DB_PASSWORD ?? 'postgres',
    },
    paymentOptions: { paymentMethodHandlers: [dummyPaymentHandler] },
    plugins: [
        DefaultJobQueuePlugin.init({}),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        ChannelProductAvailabilityPlugin.init({
            // all default to true
            enforceCatalog: true,
            enableOverridePurchasing: true,
            syncDefaultSearchIndex: true,
            validateOnCheckout: true,
        }),
        DashboardPlugin.init({ route: 'dashboard', appDir: path.join(__dirname, 'dist/dashboard') }),
    ],
};
