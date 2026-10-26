/**
 * Creates the example database: core tables and sample products via `synchronize`, without the
 * plugin's tables, then runs the plugin's migration.
 */
import { bootstrap, runMigrations } from '@vendure/core';
import { populate } from '@vendure/core/cli';
import path from 'path';
import { Client } from 'pg';

import { initialData } from '../e2e/fixtures/initial-data';

import { config } from './vendure-config';

(async () => {
    const db = config.dbConnectionOptions as any;
    const admin = new Client({ host: db.host, port: db.port, user: db.username, password: db.password, database: 'postgres' });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${db.database}`);
    await admin.query(`CREATE DATABASE ${db.database}`);
    await admin.end();

    const app = await populate(
        () => bootstrap({ ...config, dbConnectionOptions: { ...db, synchronize: true }, plugins: config.plugins!.filter(p => (p as any).name !== 'DashboardPlugin') }),
        { ...initialData, paymentMethods: [] },
        path.join(__dirname, '../e2e/fixtures/products.csv'),
    );
    await app.close();

    // synchronize created the plugin's tables too: drop them and create them with the migration
    const client = new Client({ host: db.host, port: db.port, user: db.username, password: db.password, database: db.database });
    await client.connect();
    await client.query('DROP TABLE product_channel_availability;');
    await client.end();
    await runMigrations(config);
    console.log('Example database ready');
    process.exit(0);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
