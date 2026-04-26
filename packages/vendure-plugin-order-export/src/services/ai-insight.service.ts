import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';

import { loggerCtx, PLUGIN_INIT_OPTIONS } from '../constants';
import { OrderExportPluginOptions } from '../types';
import { ExportOrderRow, OrderExportFilters } from './order-export.service';
import {
    CategoryBreakdownItem,
    DateRange,
    KpiSummary,
    TopCustomer,
    TopProduct,
} from './analytics.service';

@Injectable()
export class AIInsightService {
    constructor(
        @Inject(PLUGIN_INIT_OPTIONS) private options: Required<OrderExportPluginOptions>,
    ) {}

    /**
     * Generate insight from pre-computed analytics data (used by dashboard).
     */
    async generateInsightFromAnalytics(
        kpi: KpiSummary,
        topProducts: TopProduct[],
        topCustomers: TopCustomer[],
        categoryBreakdown: CategoryBreakdownItem[],
        dateRange: DateRange,
    ): Promise<string> {
        if (!this.options.enableAiInsights || !this.options.openAiApiKey) {
            return 'AI insights are not enabled. Configure enableAiInsights and openAiApiKey in plugin options.';
        }

        try {
            // @ts-ignore — openai is an optional peer dependency
            const OpenAI = (await import('openai')).default;
            const client = new OpenAI({ apiKey: this.options.openAiApiKey });

            const prompt = this.buildAnalyticsPrompt(kpi, topProducts, topCustomers, categoryBreakdown, dateRange);

            const completion = await client.chat.completions.create({
                model: this.options.openAiModel,
                messages: [
                    {
                        role: 'system',
                        content: `You are a senior e-commerce business analyst. Analyze the data provided and deliver a structured insight report. Be specific with numbers. Format your response with clear sections using markdown:

## Key Findings
- 2-3 bullet points on the most important trends

## Revenue Analysis
- Revenue performance, top categories, concentration risk

## Customer Insights
- Customer behavior, repeat rate, top spender patterns

## Recommendations
- 3 specific, actionable recommendations based on the data

Keep it concise but insightful. Use actual numbers from the data.`,
                    },
                    { role: 'user', content: prompt },
                ],
                max_tokens: 800,
                temperature: 0.7,
            });

            return completion.choices[0]?.message?.content?.trim() ?? 'No insight generated.';
        } catch (e: any) {
            Logger.error(`Failed to generate AI insight: ${e.message}`, loggerCtx);
            throw e;
        }
    }

    /**
     * Generate insight from raw export rows (used by scheduled reports).
     */
    async generateInsight(rows: ExportOrderRow[], filters?: OrderExportFilters): Promise<string> {
        if (!this.options.enableAiInsights || !this.options.openAiApiKey) {
            return 'AI insights are not enabled. Configure enableAiInsights and openAiApiKey in plugin options.';
        }

        try {
            // @ts-ignore — openai is an optional peer dependency
            const OpenAI = (await import('openai')).default;
            const client = new OpenAI({ apiKey: this.options.openAiApiKey });

            const metrics = this.computeMetrics(rows);
            const prompt = this.buildExportPrompt(metrics, filters);

            const completion = await client.chat.completions.create({
                model: this.options.openAiModel,
                messages: [
                    {
                        role: 'system',
                        content:
                            'You are a business analytics assistant. Provide concise, actionable insights about e-commerce order data. Keep your response to 3-5 sentences. Focus on trends, anomalies, and recommendations.',
                    },
                    { role: 'user', content: prompt },
                ],
                max_tokens: 300,
                temperature: 0.7,
            });

            return completion.choices[0]?.message?.content?.trim() ?? 'No insight generated.';
        } catch (e: any) {
            Logger.error(`Failed to generate AI insight: ${e.message}`, loggerCtx);
            throw e;
        }
    }

    private buildAnalyticsPrompt(
        kpi: KpiSummary,
        topProducts: TopProduct[],
        topCustomers: TopCustomer[],
        categoryBreakdown: CategoryBreakdownItem[],
        dateRange: DateRange,
    ): string {
        const period = `${dateRange.startDate.toISOString().split('T')[0]} to ${dateRange.endDate.toISOString().split('T')[0]}`;
        const formatMoney = (v: number) => `$${(v / 100).toFixed(2)}`;

        return `
Analyze this e-commerce store data for the period ${period}:

=== KPI Summary ===
- Total Revenue: ${formatMoney(kpi.totalRevenue)}
- Total Orders: ${kpi.totalOrders}
- Average Order Value: ${formatMoney(kpi.averageOrderValue)}
- Repeat Customer Rate: ${(kpi.repeatCustomerRate * 100).toFixed(1)}%

=== Top 5 Products by Revenue ===
${topProducts.map((p, i) => `${i + 1}. ${p.productName} — ${formatMoney(p.totalRevenue)} (${p.totalQuantity} units sold)`).join('\n')}

=== Top 5 Customers by Spend ===
${topCustomers.map((c, i) => `${i + 1}. ${c.customerName} (${c.customerEmail}) — ${formatMoney(c.totalSpent)} across ${c.orderCount} orders`).join('\n')}

=== Revenue by Collection/Category ===
${categoryBreakdown.map(c => `- ${c.category}: ${formatMoney(c.revenue)} (${c.percentage}%)`).join('\n')}

Provide a comprehensive business analysis.
        `.trim();
    }

    private computeMetrics(rows: ExportOrderRow[]) {
        const totalRevenue = rows.reduce((sum, r) => sum + r.totalWithTax, 0);
        const totalOrders = rows.length;
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        const dayDistribution: Record<string, number> = {};
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        for (const row of rows) {
            const dayName = days[new Date(row.orderDate).getDay()];
            dayDistribution[dayName] = (dayDistribution[dayName] || 0) + 1;
        }

        const productFreq: Record<string, number> = {};
        for (const row of rows) {
            const products = row.productNames.split('; ');
            for (const p of products) {
                const name = p.replace(/\s*x\d+$/, '');
                if (name) productFreq[name] = (productFreq[name] || 0) + 1;
            }
        }
        const topProducts = Object.entries(productFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => `${name} (${count} orders)`);

        const stateDistribution: Record<string, number> = {};
        for (const row of rows) {
            stateDistribution[row.orderState] = (stateDistribution[row.orderState] || 0) + 1;
        }

        return { totalRevenue: totalRevenue.toFixed(2), totalOrders, avgOrderValue: avgOrderValue.toFixed(2), dayDistribution, topProducts, stateDistribution };
    }

    private buildExportPrompt(metrics: ReturnType<AIInsightService['computeMetrics']>, filters?: OrderExportFilters) {
        const dateRange = filters?.startDate && filters?.endDate
            ? `from ${filters.startDate.toISOString().split('T')[0]} to ${filters.endDate.toISOString().split('T')[0]}`
            : 'for the selected period';

        return `
Analyze the following e-commerce order data ${dateRange}:

- Total Revenue: $${metrics.totalRevenue}
- Total Orders: ${metrics.totalOrders}
- Average Order Value: $${metrics.avgOrderValue}

Day-of-week distribution:
${Object.entries(metrics.dayDistribution).map(([day, count]) => `  ${day}: ${count} orders`).join('\n')}

Top products:
${metrics.topProducts.map(p => `  - ${p}`).join('\n')}

Order state distribution:
${Object.entries(metrics.stateDistribution).map(([state, count]) => `  ${state}: ${count}`).join('\n')}

Provide a brief business insight summary with actionable recommendations.
        `.trim();
    }
}
