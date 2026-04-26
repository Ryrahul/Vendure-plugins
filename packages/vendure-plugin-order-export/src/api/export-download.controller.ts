import { Controller, Get, Param, Res, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Allow, Ctx, RequestContext } from '@vendure/core';
import { Response } from 'express';

import { exportOrderPermission } from '../constants';
import { ExportFormat, ExportStatus } from '../entities/export-report.entity';
import { OrderExportService } from '../services/order-export.service';

@Controller('order-export')
export class ExportDownloadController {
    constructor(private orderExportService: OrderExportService) {}

    @Allow(exportOrderPermission.Permission)
    @Get('download/:id')
    async downloadReport(
        @Ctx() ctx: RequestContext,
        @Param('id') id: string,
        @Res() res: Response,
    ) {
        const report = await this.orderExportService.findOneReport(ctx, id);

        if (!report) {
            throw new NotFoundException('Export report not found');
        }

        if (report.status !== ExportStatus.COMPLETED || !report.fileData) {
            throw new NotFoundException('Export report is not ready for download');
        }

        const contentType = this.getContentType(report.type);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
        res.setHeader('Content-Length', report.fileData.length);
        res.send(report.fileData);
    }

    private getContentType(type: ExportFormat): string {
        switch (type) {
            case ExportFormat.CSV:
                return 'text/csv';
            case ExportFormat.EXCEL:
                return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            case ExportFormat.PDF:
                return 'application/pdf';
            default:
                return 'application/octet-stream';
        }
    }
}
