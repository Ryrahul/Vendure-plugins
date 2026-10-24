/**
 * Compares the database schema created by the plugin's migration with what `synchronize` would
 * create. Prints any difference for the plugin's tables and exits 1 if there is one.
 */
import { DataSource } from 'typeorm';
import { getConfig, preBootstrapConfig } from '@vendure/core';

import { config } from './vendure-config';

(async () => {
    await preBootstrapConfig(config);
    const ds = new DataSource({ ...(getConfig().dbConnectionOptions as any), synchronize: false, migrations: [] });
    await ds.initialize();
    const sql = await ds.driver.createSchemaBuilder().log();
    const relevant = sql.upQueries.filter(q => /product_launch/.test(q.query));
    for (const q of relevant) console.log(q.query);
    console.log(relevant.length ? `${relevant.length} schema differences` : 'Migration matches the entities');
    await ds.destroy();
    process.exit(relevant.length ? 1 : 0);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
