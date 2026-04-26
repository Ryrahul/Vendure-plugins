import { INestApplicationContext } from '@nestjs/common';
import { Logger, TransactionalConnection } from '@vendure/core';
import {
    ExportReport,
    ExportFormat,
    ExportStatus,
    ReportSchedule,
    ScheduleFrequency,
} from '@rahul_vendure/vendure-plugin-order-export';

/**
 * Seeds sample ExportReport and ReportSchedule entities so the
 * dashboard pages aren't empty on first load.
 */
export async function populateExportData(app: INestApplicationContext) {
    const connection = app.get(TransactionalConnection);

    try {
        // ── Sample Export Reports ──
        const reportRepo = connection.rawConnection.getRepository(ExportReport);

        await reportRepo.save([
            reportRepo.create({
                type: ExportFormat.CSV,
                status: ExportStatus.COMPLETED,
                fileName: 'order-export-sample-daily.csv',
                orderCount: 42,
                aiInsight:
                    'Revenue increased by 12% vs last week. Highest sales on Sunday. Top category: Electronics. Consider running promotions mid-week to balance order distribution.',
                filters: { startDate: daysAgo(1).toISOString(), endDate: new Date().toISOString() },
                fileData: Buffer.from('orderCode,date,total\nSAMPLE-001,2025-01-01,49.99\n'),
            }),
            reportRepo.create({
                type: ExportFormat.EXCEL,
                status: ExportStatus.COMPLETED,
                fileName: 'order-export-sample-weekly.xlsx',
                orderCount: 287,
                filters: { startDate: daysAgo(7).toISOString(), endDate: new Date().toISOString() },
                fileData: Buffer.from('sample excel placeholder'),
            }),
            reportRepo.create({
                type: ExportFormat.PDF,
                status: ExportStatus.FAILED,
                fileName: 'order-export-failed.pdf',
                orderCount: 0,
                error: 'Sample error: insufficient data for PDF generation',
                filters: null,
            }),
        ]);

        Logger.info('Created 3 sample export reports', 'Populate');

        // ── Sample Report Schedules ──
        const scheduleRepo = connection.rawConnection.getRepository(ReportSchedule);

        await scheduleRepo.save([
            scheduleRepo.create({
                name: 'Daily Revenue Report',
                enabled: true,
                frequency: ScheduleFrequency.DAILY,
                exportFormat: ExportFormat.CSV,
                recipientEmails: ['admin@example.com'],
                includeAiInsights: true,
                lastRunAt: daysAgo(0),
            }),
            scheduleRepo.create({
                name: 'Weekly Summary',
                enabled: true,
                frequency: ScheduleFrequency.WEEKLY,
                exportFormat: ExportFormat.EXCEL,
                recipientEmails: ['admin@example.com', 'manager@example.com'],
                includeAiInsights: false,
                lastRunAt: daysAgo(3),
            }),
        ]);

        Logger.info('Created 2 sample report schedules', 'Populate');
    } catch (e: any) {
        Logger.error(`Failed to populate export data: ${e.message}`, 'Populate');
    }
}

function daysAgo(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
}
