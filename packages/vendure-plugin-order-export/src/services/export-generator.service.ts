import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { JobQueue, JobQueueService, Logger, Order, RequestContext, RequestContextService, TransactionalConnection } from '@vendure/core';

import { loggerCtx, PLUGIN_INIT_OPTIONS } from '../constants';
import { ExportReport, ExportFormat, ExportStatus } from '../entities/export-report.entity';
import { OrderExportPluginOptions } from '../types';
import { OrderExportService, ExportOrderRow, OrderExportFilters } from './order-export.service';
import { AIInsightService } from './ai-insight.service';

@Injectable()
export class ExportGeneratorService implements OnModuleInit {
    private jobQueue: JobQueue<{
        reportId: string;
        format: ExportFormat;
        filters?: { startDate?: string; endDate?: string; orderStates?: string[] };
        includeAiInsights: boolean;
    }>;

    constructor(
        @Inject(PLUGIN_INIT_OPTIONS) private options: Required<OrderExportPluginOptions>,
        private jobQueueService: JobQueueService,
        private connection: TransactionalConnection,
        private orderExportService: OrderExportService,
        private aiInsightService: AIInsightService,
    ) {}

    async onModuleInit() {
        this.jobQueue = await this.jobQueueService.createQueue({
            name: 'order-export-generation',
            process: async job => {
                const { reportId, format, filters: rawFilters, includeAiInsights } = job.data;
                const reportRepo = this.connection.rawConnection.getRepository(ExportReport);
                const orderRepo = this.connection.rawConnection.getRepository(Order);

                const filters: OrderExportFilters | undefined = rawFilters
                    ? {
                          startDate: rawFilters.startDate ? new Date(rawFilters.startDate) : undefined,
                          endDate: rawFilters.endDate ? new Date(rawFilters.endDate) : undefined,
                          orderStates: rawFilters.orderStates,
                      }
                    : undefined;

                await reportRepo.update(reportId, { status: ExportStatus.PROCESSING });

                // Query orders directly via rawConnection
                const qb = orderRepo
                    .createQueryBuilder('ord')
                    .leftJoinAndSelect('ord.customer', 'customer')
                    .leftJoinAndSelect('ord.lines', 'lines')
                    .leftJoinAndSelect('lines.productVariant', 'productVariant')
                    .leftJoinAndSelect('productVariant.translations', 'pvTranslation')
                    .leftJoinAndSelect('ord.shippingLines', 'shippingLines')
                    .leftJoinAndSelect('shippingLines.shippingMethod', 'shippingMethod')
                    .leftJoinAndSelect('shippingMethod.translations', 'smTranslation')
                    .where('ord.state != :draft', { draft: 'AddingItems' })
                    .andWhere('ord.state != :created', { created: 'Created' });

                if (filters?.startDate) {
                    qb.andWhere('ord."orderPlacedAt" >= :startDate', { startDate: filters.startDate });
                }
                if (filters?.endDate) {
                    qb.andWhere('ord."orderPlacedAt" <= :endDate', { endDate: filters.endDate });
                }
                if (filters?.orderStates?.length) {
                    qb.andWhere('ord.state IN (:...states)', { states: filters.orderStates });
                }

                const orders = await qb
                    .orderBy('ord."orderPlacedAt"', 'DESC')
                    .take(this.options.maxExportRows)
                    .getMany();

                const rows = this.orderExportService.transformToExportData(orders);

                job.setProgress(50);

                let fileData: Buffer;
                switch (format) {
                    case ExportFormat.CSV:
                        fileData = await this.generateCsv(rows);
                        break;
                    case ExportFormat.EXCEL:
                        fileData = await this.generateExcel(rows);
                        break;
                    case ExportFormat.PDF:
                        fileData = await this.generatePdf(rows);
                        break;
                    default:
                        throw new Error(`Unsupported export format: ${format}`);
                }

                let aiInsight: string | null = null;
                if (includeAiInsights && this.options.enableAiInsights) {
                    try {
                        aiInsight = await this.aiInsightService.generateInsight(rows, filters);
                    } catch (e: any) {
                        Logger.warn(`AI insight generation failed: ${e.message}`, loggerCtx);
                    }
                }

                await reportRepo.update(reportId, {
                    status: ExportStatus.COMPLETED,
                    fileData,
                    orderCount: rows.length,
                    aiInsight,
                });

                Logger.info(`Export report ${reportId} completed with ${rows.length} orders`, loggerCtx);
                return { reportId, orderCount: rows.length };
            },
        });
    }

    /**
     * Add an export job to the queue. Returns immediately.
     */
    async addExportJob(
        reportId: string,
        format: ExportFormat,
        filters?: OrderExportFilters,
        includeAiInsights = false,
    ) {
        return this.jobQueue.add({
            reportId,
            format,
            filters: filters
                ? {
                      startDate: filters.startDate?.toISOString(),
                      endDate: filters.endDate?.toISOString(),
                      orderStates: filters.orderStates,
                  }
                : undefined,
            includeAiInsights,
        }, { retries: 1 });
    }

    async generateCsv(rows: ExportOrderRow[]): Promise<Buffer> {
        const { format } = await import('@fast-csv/format');

        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            const stream = format({ headers: true });
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);

            for (const row of rows) {
                stream.write(row);
            }
            stream.end();
        });
    }

    async generateExcel(rows: ExportOrderRow[]): Promise<Buffer> {
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Orders');

        if (rows.length === 0) {
            return Buffer.from(await workbook.xlsx.writeBuffer());
        }

        // Add headers
        const headers = Object.keys(rows[0]);
        sheet.addRow(headers);

        // Style header row
        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' },
        };
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

        // Add data rows
        for (const row of rows) {
            sheet.addRow(Object.values(row));
        }

        // Auto-fit columns
        sheet.columns.forEach(col => {
            let maxLen = 10;
            col.eachCell?.({ includeEmpty: true }, cell => {
                const cellLen = cell.value ? cell.value.toString().length : 0;
                if (cellLen > maxLen) maxLen = cellLen;
            });
            col.width = Math.min(maxLen + 2, 50);
        });

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    async generatePdf(rows: ExportOrderRow[]): Promise<Buffer> {
        const PDFDocument = (await import('pdfkit')).default;

        return new Promise((resolve) => {
            const chunks: Buffer[] = [];
            const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });

            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));

            // Title
            doc.fontSize(18).text('Order Export Report', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(10).text(`Generated: ${new Date().toISOString().split('T')[0]}`, { align: 'center' });
            doc.moveDown(1);

            // Summary
            const totalRevenue = rows.reduce((sum, r) => sum + r.totalWithTax, 0);
            doc.fontSize(12).text(`Total Orders: ${rows.length}    |    Total Revenue: $${totalRevenue.toFixed(2)}`);
            doc.moveDown(1);

            // Table header
            const tableHeaders = ['Code', 'Date', 'Customer', 'State', 'Items', 'Total'];
            const colWidths = [80, 80, 150, 80, 50, 80];
            let x = 40;
            const y = doc.y;

            doc.fontSize(9).font('Helvetica-Bold');
            tableHeaders.forEach((header, i) => {
                doc.text(header, x, y, { width: colWidths[i] });
                x += colWidths[i];
            });
            doc.moveDown(0.5);

            // Table rows
            doc.font('Helvetica').fontSize(8);
            const maxRows = Math.min(rows.length, 100);
            for (let i = 0; i < maxRows; i++) {
                const row = rows[i];
                const rowY = doc.y;

                if (rowY > 540) {
                    doc.addPage();
                }

                x = 40;
                const values = [
                    row.orderCode,
                    row.orderDate,
                    `${row.customerFirstName} ${row.customerLastName}`,
                    row.orderState,
                    String(row.itemCount),
                    `$${row.totalWithTax.toFixed(2)}`,
                ];

                values.forEach((val, j) => {
                    doc.text(val, x, doc.y, { width: colWidths[j], continued: j < values.length - 1 });
                    x += colWidths[j];
                });
                doc.moveDown(0.3);
            }

            if (rows.length > maxRows) {
                doc.moveDown(1);
                doc.fontSize(9).text(`... and ${rows.length - maxRows} more orders (truncated for PDF)`);
            }

            doc.end();
        });
    }
}
