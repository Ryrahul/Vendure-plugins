import { EmailEventListener } from '@vendure/email-plugin';

import { ReportGeneratedEvent } from '../events/report-generated.event';

/**
 * Email handler for scheduled report delivery.
 *
 * The consumer must:
 * 1. Add this handler to their EmailPlugin `handlers` array.
 * 2. Create an MJML template at `<templateDir>/order-export-report/body.mjml`
 *
 * Template variables available:
 * - schedule: { name, frequency, exportFormat }
 * - report: { fileName, orderCount, aiInsight }
 * - recipientEmail: string
 */
export const reportGeneratedHandler = new EmailEventListener('order-export-report')
    .on(ReportGeneratedEvent)
    .setRecipient(event => event.recipientEmail)
    .setFrom('{{ fromAddress }}')
    .setSubject('Scheduled Report: {{ schedule.name }}')
    .setTemplateVars(event => ({
        schedule: {
            name: event.schedule.name,
            frequency: event.schedule.frequency,
            exportFormat: event.schedule.exportFormat,
        },
        report: {
            fileName: event.report.fileName,
            orderCount: event.report.orderCount,
            aiInsight: event.report.aiInsight,
        },
        recipientEmail: event.recipientEmail,
    }))
    .setAttachments(event => {
        if (!event.report.fileData) return [];
        return [
            {
                filename: event.report.fileName,
                content: event.report.fileData,
            },
        ];
    });
