import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api/api-extensions';
import { OrderExportAdminResolver } from './api/admin.resolver';
import { ExportDownloadController } from './api/export-download.controller';
import { exportOrderPermission, manageReportSchedulePermission, PLUGIN_INIT_OPTIONS } from './constants';
import { ExportReport } from './entities/export-report.entity';
import { ReportSchedule } from './entities/report-schedule.entity';
import { OrderExportService } from './services/order-export.service';
import { AnalyticsService } from './services/analytics.service';
import { ExportGeneratorService } from './services/export-generator.service';
import { AIInsightService } from './services/ai-insight.service';
import { ReportSchedulerService } from './services/report-scheduler.service';
import { reportGenerationTask } from './scheduled-tasks/report-generation.task';
import { OrderExportPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ExportReport, ReportSchedule],
    adminApiExtensions: {
        resolvers: [OrderExportAdminResolver],
        schema: adminApiExtensions,
    },
    controllers: [ExportDownloadController],
    providers: [
        OrderExportService,
        AnalyticsService,
        ExportGeneratorService,
        AIInsightService,
        ReportSchedulerService,
        {
            provide: PLUGIN_INIT_OPTIONS,
            useFactory: () => OrderExportPlugin.options,
        },
    ],
    configuration: (config) => {
        config.authOptions.customPermissions.push(
            exportOrderPermission,
            manageReportSchedulePermission,
        );
        config.schedulerOptions.tasks.push(reportGenerationTask);
        return config;
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.3.0',
})
export class OrderExportPlugin {
    static options: Required<OrderExportPluginOptions>;

    static init(options?: OrderExportPluginOptions): Type<OrderExportPlugin> {
        this.options = {
            enableAiInsights: false,
            openAiApiKey: '',
            openAiModel: 'gpt-4o-mini',
            reportSenderEmail: '',
            maxExportRows: 10000,
            ...(options ?? {}),
        };
        return OrderExportPlugin;
    }
}
