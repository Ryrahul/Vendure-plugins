import { RequestContext, VendureEvent } from '@vendure/core';

import { ExportReport } from '../entities/export-report.entity';
import { ReportSchedule } from '../entities/report-schedule.entity';

/**
 * Emitted when a scheduled report has been generated. The EmailPlugin
 * can subscribe to this event to send the report as an email attachment.
 */
export class ReportGeneratedEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public report: ExportReport,
        public schedule: ReportSchedule,
        public recipientEmail: string,
    ) {
        super();
    }
}
