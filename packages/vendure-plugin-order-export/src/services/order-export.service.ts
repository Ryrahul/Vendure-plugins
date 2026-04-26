import { Injectable } from '@nestjs/common';
import {
    ID,
    ListQueryBuilder,
    ListQueryOptions,
    Logger,
    Order,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { Between, In } from 'typeorm';

import { loggerCtx } from '../constants';
import { ExportReport, ExportFormat, ExportStatus } from '../entities/export-report.entity';

export interface OrderExportFilters {
    startDate?: Date;
    endDate?: Date;
    orderStates?: string[];
}

export interface ExportOrderRow {
    orderCode: string;
    orderDate: string;
    customerFirstName: string;
    customerLastName: string;
    customerEmail: string;
    orderState: string;
    currencyCode: string;
    subTotal: number;
    shipping: number;
    totalBeforeTax: number;
    totalWithTax: number;
    itemCount: number;
    productNames: string;
    shippingMethod: string;
    shippingAddress: string;
}

@Injectable()
export class OrderExportService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
    ) {}

    async findAllReports(ctx: RequestContext, options?: ListQueryOptions<ExportReport>) {
        return this.listQueryBuilder
            .build(ExportReport, options, { ctx })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    async findOneReport(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, ExportReport).findOne({ where: { id } });
    }

    async createReport(ctx: RequestContext, type: ExportFormat, filters?: OrderExportFilters): Promise<ExportReport> {
        const report = new ExportReport({
            type,
            status: ExportStatus.PENDING,
            fileName: this.generateFileName(type),
            filters: filters as any ?? null,
        });
        return this.connection.getRepository(ctx, ExportReport).save(report);
    }

    async updateReport(ctx: RequestContext, id: ID, updates: Partial<ExportReport>): Promise<ExportReport> {
        await this.connection.getRepository(ctx, ExportReport).update(id, updates);
        return this.connection.getRepository(ctx, ExportReport).findOneOrFail({ where: { id } });
    }



    async deleteReport(ctx: RequestContext, id: ID) {
        await this.connection.getRepository(ctx, ExportReport).delete(id);
        return { result: 'DELETED' as const, message: 'Export report deleted' };
    }

    async getOrdersForExport(ctx: RequestContext, filters?: OrderExportFilters, maxRows = 10000): Promise<Order[]> {
        const qb = this.connection
            .getRepository(ctx, Order)
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

        qb.orderBy('ord."orderPlacedAt"', 'DESC')
            .take(maxRows);

        return qb.getMany();
    }

    transformToExportData(orders: Order[]): ExportOrderRow[] {
        return orders.map(order => {
            const productNames = order.lines
                ?.map(l => {
                    const name = l.productVariant?.translations?.[0]?.name
                        ?? l.productVariant?.name
                        ?? 'Unknown';
                    return `${name} x${l.quantity}`;
                })
                .join('; ') ?? '';

            const shippingMethod = order.shippingLines?.[0]?.shippingMethod?.translations?.[0]?.name
                ?? order.shippingLines?.[0]?.shippingMethod?.name
                ?? 'N/A';

            const addr = order.shippingAddress;
            const shippingAddress = addr
                ? [addr.streetLine1, addr.city, addr.province, addr.postalCode, addr.country].filter(Boolean).join(', ')
                : 'N/A';

            const totalWithTax = (order.subTotalWithTax + order.shippingWithTax) / 100;

            return {
                orderCode: order.code,
                orderDate: (order.orderPlacedAt ?? order.createdAt).toISOString().split('T')[0],
                customerFirstName: order.customer?.firstName ?? '',
                customerLastName: order.customer?.lastName ?? '',
                customerEmail: order.customer?.emailAddress ?? '',
                orderState: order.state,
                currencyCode: order.currencyCode,
                subTotal: order.subTotal / 100,
                shipping: order.shipping / 100,
                totalBeforeTax: order.subTotal / 100,
                totalWithTax,
                itemCount: order.lines?.reduce((sum, l) => sum + l.quantity, 0) ?? 0,
                productNames,
                shippingMethod,
                shippingAddress,
            };
        });
    }

    private generateFileName(type: ExportFormat): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = type === ExportFormat.CSV ? 'csv' : type === ExportFormat.EXCEL ? 'xlsx' : 'pdf';
        return `order-export-${timestamp}.${ext}`;
    }
}
