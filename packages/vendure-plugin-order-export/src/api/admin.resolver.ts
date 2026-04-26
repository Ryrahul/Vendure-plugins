import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ListQueryOptions, RequestContext, Transaction } from '@vendure/core';

import { exportOrderPermission, manageReportSchedulePermission } from '../constants';
import { ExportReport, ExportFormat } from '../entities/export-report.entity';
import { ReportSchedule, ScheduleFrequency } from '../entities/report-schedule.entity';
import { OrderExportService, OrderExportFilters } from '../services/order-export.service';
import { AnalyticsService, DateRange } from '../services/analytics.service';
import { ExportGeneratorService } from '../services/export-generator.service';
import { AIInsightService } from '../services/ai-insight.service';
import { ReportSchedulerService } from '../services/report-scheduler.service';
import {
    QueryExportReportArgs,
    QueryReportScheduleArgs,
    QueryOrderAnalyticsArgs,
    QueryGenerateAiInsightArgs,
    MutationCreateExportReportArgs,
    MutationDeleteExportReportArgs,
    MutationCreateReportScheduleArgs,
    MutationUpdateReportScheduleArgs,
    MutationDeleteReportScheduleArgs,
    MutationToggleReportScheduleArgs,
} from '../generated-graphql-types';

@Resolver()
export class OrderExportAdminResolver {
    constructor(
        private orderExportService: OrderExportService,
        private analyticsService: AnalyticsService,
        private exportGeneratorService: ExportGeneratorService,
        private aiInsightService: AIInsightService,
        private reportSchedulerService: ReportSchedulerService,
    ) {}

    // ── Export Reports ──

    @Allow(exportOrderPermission.Permission)
    @Query()
    async exportReports(
        @Ctx() ctx: RequestContext,
        @Args() args: { options: ListQueryOptions<ExportReport> },
    ) {
        return this.orderExportService.findAllReports(ctx, args.options ?? undefined);
    }

    @Allow(exportOrderPermission.Permission)
    @Query()
    async exportReport(@Ctx() ctx: RequestContext, @Args() args: QueryExportReportArgs) {
        return this.orderExportService.findOneReport(ctx, args.id);
    }

    @Allow(exportOrderPermission.Permission)
    @Mutation()
    async createExportReport(@Ctx() ctx: RequestContext, @Args() args: MutationCreateExportReportArgs) {
        const { type, filters, includeAiInsights } = args.input;
        const exportFilters: OrderExportFilters | undefined = filters
            ? {
                   startDate: filters.startDate ? new Date(filters.startDate) : undefined,
                   endDate: filters.endDate ? new Date(filters.endDate) : undefined,
                   orderStates: filters.orderStates ?? undefined,
              }
            : undefined;

        const report = await this.orderExportService.createReport(ctx, type as ExportFormat, exportFilters);

        // Add to job queue — processed on the worker with rawConnection
        await this.exportGeneratorService.addExportJob(
            report.id.toString(),
            type as ExportFormat,
            exportFilters,
            includeAiInsights ?? false,
        );

        return report;
    }

    @Transaction()
    @Allow(exportOrderPermission.Permission)
    @Mutation()
    async deleteExportReport(@Ctx() ctx: RequestContext, @Args() args: MutationDeleteExportReportArgs) {
        return this.orderExportService.deleteReport(ctx, args.id);
    }

    // ── Report Schedules ──

    @Allow(manageReportSchedulePermission.Permission)
    @Query()
    async reportSchedules(
        @Ctx() ctx: RequestContext,
        @Args() args: { options: ListQueryOptions<ReportSchedule> },
    ) {
        return this.reportSchedulerService.findAll(ctx, args.options ?? undefined);
    }

    @Allow(manageReportSchedulePermission.Permission)
    @Query()
    async reportSchedule(@Ctx() ctx: RequestContext, @Args() args: QueryReportScheduleArgs) {
        return this.reportSchedulerService.findOne(ctx, args.id);
    }

    @Transaction()
    @Allow(manageReportSchedulePermission.Permission)
    @Mutation()
    async createReportSchedule(@Ctx() ctx: RequestContext, @Args() args: MutationCreateReportScheduleArgs) {
        return this.reportSchedulerService.create(ctx, {
            name: args.input.name,
            frequency: args.input.frequency as ScheduleFrequency,
            exportFormat: args.input.exportFormat as ExportFormat,
            recipientEmails: args.input.recipientEmails,
            filters: args.input.filters ?? undefined,
            includeAiInsights: args.input.includeAiInsights ?? false,
        });
    }

    @Transaction()
    @Allow(manageReportSchedulePermission.Permission)
    @Mutation()
    async updateReportSchedule(@Ctx() ctx: RequestContext, @Args() args: MutationUpdateReportScheduleArgs) {
        const { id, ...rest } = args.input;
        return this.reportSchedulerService.update(ctx, id, {
            ...rest,
            frequency: rest.frequency as ScheduleFrequency | undefined,
            exportFormat: rest.exportFormat as ExportFormat | undefined,
            recipientEmails: rest.recipientEmails ?? undefined,
            filters: rest.filters ?? undefined,
            includeAiInsights: rest.includeAiInsights ?? undefined,
            enabled: rest.enabled ?? undefined,
        });
    }

    @Transaction()
    @Allow(manageReportSchedulePermission.Permission)
    @Mutation()
    async deleteReportSchedule(@Ctx() ctx: RequestContext, @Args() args: MutationDeleteReportScheduleArgs) {
        return this.reportSchedulerService.delete(ctx, args.id);
    }

    @Transaction()
    @Allow(manageReportSchedulePermission.Permission)
    @Mutation()
    async toggleReportSchedule(@Ctx() ctx: RequestContext, @Args() args: MutationToggleReportScheduleArgs) {
        return this.reportSchedulerService.toggleSchedule(ctx, args.id);
    }

    // ── Analytics ──

    @Allow(exportOrderPermission.Permission)
    @Query()
    async orderAnalytics(@Ctx() ctx: RequestContext, @Args() args: QueryOrderAnalyticsArgs) {
        const dateRange: DateRange = {
            startDate: new Date(args.input.startDate),
            endDate: new Date(args.input.endDate),
        };
        const granularity = (args.input.granularity?.toLowerCase() as 'day' | 'week' | 'month') ?? 'day';

        const [kpi, revenueOverTime, orderCountOverTime, topProducts, topCustomers, categoryBreakdown] =
            await Promise.all([
                this.analyticsService.getKpiSummary(ctx, dateRange),
                this.analyticsService.getRevenueOverTime(ctx, dateRange, granularity),
                this.analyticsService.getOrderCountOverTime(ctx, dateRange, granularity),
                this.analyticsService.getTopProducts(ctx, dateRange),
                this.analyticsService.getTopCustomers(ctx, dateRange),
                this.analyticsService.getCategoryBreakdown(ctx, dateRange),
            ]);

        return { kpi, revenueOverTime, orderCountOverTime, topProducts, topCustomers, categoryBreakdown };
    }

    @Allow(exportOrderPermission.Permission)
    @Query()
    async generateAiInsight(@Ctx() ctx: RequestContext, @Args() args: QueryGenerateAiInsightArgs) {
        const dateRange = {
            startDate: new Date(args.input.startDate),
            endDate: new Date(args.input.endDate),
        };

        // Gather analytics data instead of loading raw orders — more efficient and avoids connection issues
        const [kpi, topProducts, topCustomers, categoryBreakdown] = await Promise.all([
            this.analyticsService.getKpiSummary(ctx, dateRange),
            this.analyticsService.getTopProducts(ctx, dateRange, 5),
            this.analyticsService.getTopCustomers(ctx, dateRange, 5),
            this.analyticsService.getCategoryBreakdown(ctx, dateRange),
        ]);

        return this.aiInsightService.generateInsightFromAnalytics(
            kpi,
            topProducts,
            topCustomers,
            categoryBreakdown,
            dateRange,
        );
    }
}
