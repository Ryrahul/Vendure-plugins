import { Inject, Injectable } from '@nestjs/common';
import {
    EventBus,
    ID,
    ListQueryBuilder,
    ListQueryOptions,
    Logger,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

import { loggerCtx, PLUGIN_INIT_OPTIONS } from '../constants';
import { ExportFormat } from '../entities/export-report.entity';
import { ReportSchedule, ScheduleFrequency } from '../entities/report-schedule.entity';
import { ReportGeneratedEvent } from '../events/report-generated.event';
import { OrderExportPluginOptions } from '../types';
import { ExportGeneratorService } from './export-generator.service';
import { OrderExportService, OrderExportFilters } from './order-export.service';

@Injectable()
export class ReportSchedulerService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private orderExportService: OrderExportService,
        private exportGenerator: ExportGeneratorService,
        private eventBus: EventBus,
        @Inject(PLUGIN_INIT_OPTIONS) private options: Required<OrderExportPluginOptions>,
    ) {}

    async findAll(ctx: RequestContext, options?: ListQueryOptions<ReportSchedule>) {
        return this.listQueryBuilder
            .build(ReportSchedule, options, { ctx })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    async findOne(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, ReportSchedule).findOne({ where: { id } });
    }

    async create(ctx: RequestContext, input: {
        name: string;
        frequency: ScheduleFrequency;
        exportFormat: ExportFormat;
        recipientEmails: string[];
        filters?: Record<string, any>;
        includeAiInsights?: boolean;
    }): Promise<ReportSchedule> {
        const schedule = new ReportSchedule({
            name: input.name,
            enabled: true,
            frequency: input.frequency,
            exportFormat: input.exportFormat,
            recipientEmails: input.recipientEmails,
            filters: input.filters ?? null,
            includeAiInsights: input.includeAiInsights ?? false,
        });
        return this.connection.getRepository(ctx, ReportSchedule).save(schedule);
    }

    async update(ctx: RequestContext, id: ID, input: Partial<{
        name: string;
        frequency: ScheduleFrequency;
        exportFormat: ExportFormat;
        recipientEmails: string[];
        filters: Record<string, any>;
        includeAiInsights: boolean;
        enabled: boolean;
    }>): Promise<ReportSchedule> {
        await this.connection.getRepository(ctx, ReportSchedule).update(id, input);
        return this.connection.getRepository(ctx, ReportSchedule).findOneOrFail({ where: { id } });
    }

    async delete(ctx: RequestContext, id: ID) {
        await this.connection.getRepository(ctx, ReportSchedule).delete(id);
        return { result: 'DELETED' as const, message: 'Report schedule deleted' };
    }

    async toggleSchedule(ctx: RequestContext, id: ID): Promise<ReportSchedule> {
        const schedule = await this.connection
            .getRepository(ctx, ReportSchedule)
            .findOneOrFail({ where: { id } });
        schedule.enabled = !schedule.enabled;
        return this.connection.getRepository(ctx, ReportSchedule).save(schedule);
    }

    /**
     * Called by the ScheduledTask (hourly). Checks all enabled schedules
     * and triggers any that are due based on frequency + lastRunAt.
     */
    async processDueSchedules(ctx: RequestContext): Promise<void> {
        const schedules = await this.connection
            .getRepository(ctx, ReportSchedule)
            .find({ where: { enabled: true } });

        for (const schedule of schedules) {
            if (this.isDue(schedule)) {
                Logger.info(`Running scheduled report: ${schedule.name}`, loggerCtx);
                try {
                    await this.executeScheduledReport(ctx, schedule);
                } catch (e: any) {
                    Logger.error(
                        `Failed to execute scheduled report "${schedule.name}": ${e.message}`,
                        loggerCtx,
                    );
                }
            }
        }
    }

    private async executeScheduledReport(ctx: RequestContext, schedule: ReportSchedule): Promise<void> {
        const filters = this.buildFiltersForSchedule(schedule);
        const report = await this.orderExportService.createReport(ctx, schedule.exportFormat, filters);

        await this.exportGenerator.addExportJob(
            report.id.toString(),
            schedule.exportFormat,
            filters,
            schedule.includeAiInsights,
        );

        const completedReport = await this.orderExportService.findOneReport(ctx, report.id);
        if (!completedReport) return;

        // Mark as run
        await this.connection
            .getRepository(ctx, ReportSchedule)
            .update(schedule.id, { lastRunAt: new Date() });

        // Emit event for each recipient — EmailPlugin picks this up
        for (const email of schedule.recipientEmails) {
            await this.eventBus.publish(
                new ReportGeneratedEvent(ctx, completedReport, schedule, email),
            );
        }
    }

    /**
     * Simple date-math check: has enough time passed since lastRunAt
     * for this frequency?
     */
    private isDue(schedule: ReportSchedule): boolean {
        const now = new Date();
        const lastRun = schedule.lastRunAt;

        // Never run before — due immediately
        if (!lastRun) return true;

        const elapsedMs = now.getTime() - lastRun.getTime();
        const ONE_HOUR = 60 * 60 * 1000;
        const ONE_DAY = 24 * ONE_HOUR;

        switch (schedule.frequency) {
            case ScheduleFrequency.DAILY:
                return elapsedMs >= ONE_DAY;
            case ScheduleFrequency.WEEKLY:
                return elapsedMs >= 7 * ONE_DAY;
            case ScheduleFrequency.MONTHLY:
                return elapsedMs >= 28 * ONE_DAY; // ~4 weeks
            default:
                return false;
        }
    }

    private buildFiltersForSchedule(schedule: ReportSchedule): OrderExportFilters {
        const now = new Date();
        let startDate: Date;

        switch (schedule.frequency) {
            case ScheduleFrequency.DAILY:
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 1);
                break;
            case ScheduleFrequency.WEEKLY:
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 7);
                break;
            case ScheduleFrequency.MONTHLY:
                startDate = new Date(now);
                startDate.setMonth(startDate.getMonth() - 1);
                break;
        }

        return {
            startDate,
            endDate: now,
            ...(schedule.filters ?? {}),
        };
    }
}
