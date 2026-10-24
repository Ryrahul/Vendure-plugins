import { ScheduledTask } from '@vendure/core';

import { PROCESS_DUE_TASK_ID } from './constants';
import { ProductLaunchExecutorService } from './services/product-launch-executor.service';
import { ResolvedProductLaunchSchedulerOptions } from './types';

/**
 * The one recurring task that runs due schedule steps. Vendure runs it on the worker; with
 * `DefaultSchedulerPlugin` only one worker runs it at a time.
 */
export function createProcessDueTask(options: ResolvedProductLaunchSchedulerOptions) {
    return new ScheduledTask({
        id: PROCESS_DUE_TASK_ID,
        description: 'Enables or disables products whose launch schedule is due',
        schedule: options.pollSchedule,
        timeout: options.leaseSeconds * 1000,
        preventOverlap: true,
        execute: ({ injector }) => injector.get(ProductLaunchExecutorService).processDue(),
    });
}
