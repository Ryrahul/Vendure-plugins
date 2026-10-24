import { bootstrap } from '@vendure/core';

import { config } from './vendure-config';

bootstrap(config).catch(e => {
    console.error(e);
    process.exit(1);
});
