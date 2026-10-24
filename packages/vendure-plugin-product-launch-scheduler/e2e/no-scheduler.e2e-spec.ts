import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SCHEDULER_STATUS } from './graphql';
import { createSchedulerTestEnvironment, serverInitOptions } from './utils/test-environment';

describe('without a scheduler', () => {
    const { server, adminClient } = createSchedulerTestEnvironment({}, {}, { withScheduler: false });

    beforeAll(async () => {
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
    });

    afterAll(async () => {
        await server.destroy();
    });

    it('reports that schedules will not run', async () => {
        const { productLaunchSchedulerStatus } = await adminClient.query(SCHEDULER_STATUS);
        expect(productLaunchSchedulerStatus.schedulerRunning).toBe(false);
    });
});
