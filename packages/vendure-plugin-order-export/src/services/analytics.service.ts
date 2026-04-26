import { Injectable } from '@nestjs/common';
import { Order, RequestContext, TransactionalConnection } from '@vendure/core';

import { loggerCtx } from '../constants';

export interface DateRange {
    startDate: Date;
    endDate: Date;
}

export interface KpiSummary {
    totalRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
    repeatCustomerRate: number;
}

export interface TimeSeriesPoint {
    date: string;
    value: number;
}

export interface TopProduct {
    productId: string;
    productName: string;
    totalRevenue: number;
    totalQuantity: number;
}

export interface TopCustomer {
    customerId: string;
    customerName: string;
    customerEmail: string;
    totalSpent: number;
    orderCount: number;
}

export interface CategoryBreakdownItem {
    category: string;
    revenue: number;
    percentage: number;
}

@Injectable()
export class AnalyticsService {
    constructor(private connection: TransactionalConnection) {}

    async getKpiSummary(ctx: RequestContext, dateRange: DateRange): Promise<KpiSummary> {
        const repo = this.connection.getRepository(ctx, Order);

        const result = await repo
            .createQueryBuilder('ord')
            .select('COUNT(ord.id)', 'totalOrders')
            .addSelect('COALESCE(SUM(ord."subTotalWithTax" + ord."shippingWithTax"), 0)', 'totalRevenue')
            .where('ord."orderPlacedAt" >= :start', { start: dateRange.startDate })
            .andWhere('ord."orderPlacedAt" <= :end', { end: dateRange.endDate })
            .andWhere('ord.state NOT IN (:...excludeStates)', {
                excludeStates: ['AddingItems', 'Created', 'Cancelled'],
            })
            .getRawOne();

        const totalOrders = parseInt(result.totalOrders, 10) || 0;
        const totalRevenue = parseInt(result.totalRevenue, 10) || 0;
        const averageOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

        // Calculate repeat customer rate
        const customerStats = await repo
            .createQueryBuilder('ord')
            .select('ord."customerId"', 'customerId')
            .addSelect('COUNT(ord.id)', 'orderCount')
            .where('ord."orderPlacedAt" >= :start', { start: dateRange.startDate })
            .andWhere('ord."orderPlacedAt" <= :end', { end: dateRange.endDate })
            .andWhere('ord.state NOT IN (:...excludeStates)', {
                excludeStates: ['AddingItems', 'Created', 'Cancelled'],
            })
            .andWhere('ord."customerId" IS NOT NULL')
            .groupBy('ord."customerId"')
            .getRawMany();

        const totalCustomers = customerStats.length;
        const repeatCustomers = customerStats.filter(c => parseInt(c.orderCount, 10) > 1).length;
        const repeatCustomerRate = totalCustomers > 0 ? repeatCustomers / totalCustomers : 0;

        return { totalRevenue, totalOrders, averageOrderValue, repeatCustomerRate };
    }

    async getRevenueOverTime(
        ctx: RequestContext,
        dateRange: DateRange,
        granularity: 'day' | 'week' | 'month' = 'day',
    ): Promise<TimeSeriesPoint[]> {
        const repo = this.connection.getRepository(ctx, Order);
        const dateTrunc = granularity === 'day' ? 'day' : granularity === 'week' ? 'week' : 'month';

        const results = await repo
            .createQueryBuilder('ord')
            .select(`DATE_TRUNC('${dateTrunc}', ord."orderPlacedAt")`, 'date')
            .addSelect('COALESCE(SUM(ord."subTotalWithTax" + ord."shippingWithTax"), 0)', 'value')
            .where('ord."orderPlacedAt" >= :start', { start: dateRange.startDate })
            .andWhere('ord."orderPlacedAt" <= :end', { end: dateRange.endDate })
            .andWhere('ord.state NOT IN (:...excludeStates)', {
                excludeStates: ['AddingItems', 'Created', 'Cancelled'],
            })
            .groupBy(`DATE_TRUNC('${dateTrunc}', ord."orderPlacedAt")`)
            .orderBy('date', 'ASC')
            .getRawMany();

        return results.map(r => ({
            date: new Date(r.date).toISOString().split('T')[0],
            value: parseInt(r.value, 10) || 0,
        }));
    }

    async getOrderCountOverTime(
        ctx: RequestContext,
        dateRange: DateRange,
        granularity: 'day' | 'week' | 'month' = 'day',
    ): Promise<TimeSeriesPoint[]> {
        const repo = this.connection.getRepository(ctx, Order);
        const dateTrunc = granularity === 'day' ? 'day' : granularity === 'week' ? 'week' : 'month';

        const results = await repo
            .createQueryBuilder('ord')
            .select(`DATE_TRUNC('${dateTrunc}', ord."orderPlacedAt")`, 'date')
            .addSelect('COUNT(ord.id)', 'value')
            .where('ord."orderPlacedAt" >= :start', { start: dateRange.startDate })
            .andWhere('ord."orderPlacedAt" <= :end', { end: dateRange.endDate })
            .andWhere('ord.state NOT IN (:...excludeStates)', {
                excludeStates: ['AddingItems', 'Created', 'Cancelled'],
            })
            .groupBy(`DATE_TRUNC('${dateTrunc}', ord."orderPlacedAt")`)
            .orderBy('date', 'ASC')
            .getRawMany();

        return results.map(r => ({
            date: new Date(r.date).toISOString().split('T')[0],
            value: parseInt(r.value, 10) || 0,
        }));
    }

    async getTopProducts(ctx: RequestContext, dateRange: DateRange, limit = 10): Promise<TopProduct[]> {
        const results = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('ord')
            .innerJoin('ord.lines', 'line')
            .innerJoin('line.productVariant', 'variant')
            .leftJoin('product_variant_translation', 'vt', 'vt."baseId" = variant.id AND vt."languageCode" = :lang', { lang: 'en' })
            .select('variant."productId"', 'productId')
            .addSelect('MAX(vt.name)', 'productName')
            .addSelect('SUM(line."listPrice" * line.quantity)', 'totalRevenue')
            .addSelect('SUM(line.quantity)', 'totalQuantity')
            .where('ord."orderPlacedAt" >= :start', { start: dateRange.startDate })
            .andWhere('ord."orderPlacedAt" <= :end', { end: dateRange.endDate })
            .andWhere('ord.state NOT IN (:...excludeStates)', {
                excludeStates: ['AddingItems', 'Created', 'Cancelled'],
            })
            .groupBy('variant."productId"')
            .orderBy('"totalRevenue"', 'DESC')
            .limit(limit)
            .getRawMany();

        return results.map(r => ({
            productId: r.productId,
            productName: r.productName,
            totalRevenue: parseInt(r.totalRevenue, 10) || 0,
            totalQuantity: parseInt(r.totalQuantity, 10) || 0,
        }));
    }

    async getTopCustomers(ctx: RequestContext, dateRange: DateRange, limit = 10): Promise<TopCustomer[]> {
        const results = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('ord')
            .innerJoin('ord.customer', 'customer')
            .select('customer.id', 'customerId')
            .addSelect("CONCAT(customer.\"firstName\", ' ', customer.\"lastName\")", 'customerName')
            .addSelect('customer."emailAddress"', 'customerEmail')
            .addSelect('SUM(ord."subTotalWithTax" + ord."shippingWithTax")', 'totalSpent')
            .addSelect('COUNT(ord.id)', 'orderCount')
            .where('ord."orderPlacedAt" >= :start', { start: dateRange.startDate })
            .andWhere('ord."orderPlacedAt" <= :end', { end: dateRange.endDate })
            .andWhere('ord.state NOT IN (:...excludeStates)', {
                excludeStates: ['AddingItems', 'Created', 'Cancelled'],
            })
            .groupBy('customer.id')
            .addGroupBy('customer."firstName"')
            .addGroupBy('customer."lastName"')
            .addGroupBy('customer."emailAddress"')
            .orderBy('"totalSpent"', 'DESC')
            .limit(limit)
            .getRawMany();

        return results.map(r => ({
            customerId: r.customerId,
            customerName: r.customerName,
            customerEmail: r.customerEmail,
            totalSpent: parseInt(r.totalSpent, 10) || 0,
            orderCount: parseInt(r.orderCount, 10) || 0,
        }));
    }

    async getCategoryBreakdown(ctx: RequestContext, dateRange: DateRange): Promise<CategoryBreakdownItem[]> {
        // All collections (including nested), grouped by collection name
        const results = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('ord')
            .innerJoin('ord.lines', 'line')
            .innerJoin('line.productVariant', 'variant')
            .innerJoin(
                'collection_product_variants_product_variant',
                'cpv',
                'cpv."productVariantId" = variant.id',
            )
            .innerJoin('collection', 'col', 'col.id = cpv."collectionId" AND col."isRoot" = false')
            .innerJoin(
                'collection_translation',
                'ct',
                'ct."baseId" = col.id AND ct."languageCode" = :lang',
                { lang: 'en' },
            )
            .select('ct.name', 'category')
            .addSelect('SUM(line."listPrice" * line.quantity)', 'revenue')
            .where('ord."orderPlacedAt" >= :start', { start: dateRange.startDate })
            .andWhere('ord."orderPlacedAt" <= :end', { end: dateRange.endDate })
            .andWhere('ord.state NOT IN (:...excludeStates)', {
                excludeStates: ['AddingItems', 'Created', 'Cancelled'],
            })
            .groupBy('ct.name')
            .orderBy('"revenue"', 'DESC')
            .getRawMany();

        const totalRevenue = results.reduce((sum, r) => sum + (parseInt(r.revenue, 10) || 0), 0);

        // Show top 8, group the rest into "Other"
        const MAX_SLICES = 6;
        const items: CategoryBreakdownItem[] = [];
        let otherRevenue = 0;

        for (let i = 0; i < results.length; i++) {
            const revenue = parseInt(results[i].revenue, 10) || 0;
            if (i < MAX_SLICES) {
                items.push({
                    category: results[i].category,
                    revenue,
                    percentage: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 10000) / 100 : 0,
                });
            } else {
                otherRevenue += revenue;
            }
        }

        if (otherRevenue > 0) {
            items.push({
                category: 'Other',
                revenue: otherRevenue,
                percentage: totalRevenue > 0 ? Math.round((otherRevenue / totalRevenue) * 10000) / 100 : 0,
            });
        }

        return items;
    }
}
