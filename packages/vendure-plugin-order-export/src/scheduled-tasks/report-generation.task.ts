import { RequestContextService, ScheduledTask } from '@vendure/core';

import { ReportSchedulerService } from '../services/report-scheduler.service';

/**
 * A Vendure ScheduledTask that runs hourly on the worker.
 * Checks all enabled ReportSchedule entities and triggers
 * any that are due based on their frequency and lastRunAt.
 *
 * Uses DefaultSchedulerPlugin's only-once locking — safe
 * across multiple worker instances.
 */
export const reportGenerationTask = new ScheduledTask({
    id: 'order-export-scheduled-reports',
    description: 'Checks for due report schedules and generates exports',
    schedule: cron => cron.everyHour(),
    async execute({ injector }) {
        const schedulerService = injector.get(ReportSchedulerService);
        const ctx = await injector.get(RequestContextService).create({
            apiType: 'admin',
        });
        await schedulerService.processDueSchedules(ctx);
    },
});
