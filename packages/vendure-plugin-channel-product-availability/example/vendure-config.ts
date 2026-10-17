/**
 * Minimal Vendure config using the plugin. Not published; typechecked with the package.
 */
import { DefaultJobQueuePlugin, DefaultSearchPlugin, dummyPaymentHandler, VendureConfig } from '@vendure/core';
import path from 'path';

import { ChannelProductAvailabilityMigration1792195200000, ChannelProductAvailabilityPlugin } from '../src';

export const config: VendureConfig = {
    apiOptions: { port: 3000, adminApiPath: 'admin-api', shopApiPath: 'shop-api' },
    authOptions: { tokenMethod: ['bearer', 'cookie'] },
    dbConnectionOptions: {
        type: 'postgres',
        synchronize: false,
        // Either ship the plugin's migration…
        migrations: [ChannelProductAvailabilityMigration1792195200000, path.join(__dirname, 'migrations/*.+(js|ts)')],
        // …or generate your own with `npx vendure migrate` — not both.
        database: process.env.DB_NAME,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
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
    ],
};
