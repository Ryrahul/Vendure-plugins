import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    api,
    Button,
    DashboardRouteDefinition,
    Page,
    PageBlock,
    PageLayout,
    PageTitle,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@vendure/dashboard';

import { getOrderAnalyticsQuery } from './order-export.graphql';
import { StatsCards } from './components/stats-cards';
import { RevenueChart } from './components/revenue-chart';
import { OrdersChart } from './components/orders-chart';
import { TopProductsTable } from './components/top-products-table';
import { TopCustomersTable } from './components/top-customers-table';
import { CategoryBreakdown } from './components/category-breakdown';
import { AiInsightsCard } from './components/ai-insights-card';

type DateRangePreset = '7d' | '30d' | '90d' | '1y';

function getDateRange(preset: DateRangePreset) {
    const end = new Date();
    const start = new Date();
    switch (preset) {
        case '7d':
            start.setDate(start.getDate() - 7);
            break;
        case '30d':
            start.setDate(start.getDate() - 30);
            break;
        case '90d':
            start.setDate(start.getDate() - 90);
            break;
        case '1y':
            start.setFullYear(start.getFullYear() - 1);
            break;
    }
    return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
    };
}

function getGranularity(preset: DateRangePreset) {
    switch (preset) {
        case '7d':
            return 'DAY';
        case '30d':
            return 'DAY';
        case '90d':
            return 'WEEK';
        case '1y':
            return 'MONTH';
    }
}

export const analyticsDashboard: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'order-analytics',
        id: 'analytics-dashboard',
        url: '/order-analytics',
        title: 'Dashboard',
    },
    path: '/order-analytics',
    loader: () => ({ breadcrumb: 'Order Analytics' }),
    component: () => <AnalyticsDashboardPage />,
};

function AnalyticsDashboardPage() {
    const [preset, setPreset] = useState<DateRangePreset>('30d');
    const { startDate, endDate } = getDateRange(preset);
    const granularity = getGranularity(preset);

    const { data, isLoading } = useQuery({
        queryKey: ['orderAnalytics', preset],
        queryFn: () =>
            api.query(getOrderAnalyticsQuery, {
                input: { startDate, endDate, granularity },
            }),
    });

    const analytics = data?.orderAnalytics;

    return (
        <Page pageId="order-analytics-dashboard">
            <PageTitle>Order Analytics</PageTitle>
            <PageLayout>
                <PageBlock column="main" blockId="analytics-controls">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-semibold">Overview</h2>
                        <Select
                            value={preset}
                            onValueChange={(v) => setPreset(v as DateRangePreset)}
                        >
                            <SelectTrigger className="w-[140px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="7d">Last 7 days</SelectItem>
                                <SelectItem value="30d">Last 30 days</SelectItem>
                                <SelectItem value="90d">Last 90 days</SelectItem>
                                <SelectItem value="1y">Last year</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </PageBlock>

                <PageBlock column="main" blockId="kpi-cards">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground">
                            Loading analytics...
                        </div>
                    ) : analytics ? (
                        <StatsCards
                            totalRevenue={analytics.kpi.totalRevenue}
                            totalOrders={analytics.kpi.totalOrders}
                            averageOrderValue={analytics.kpi.averageOrderValue}
                            repeatCustomerRate={analytics.kpi.repeatCustomerRate}
                        />
                    ) : null}
                </PageBlock>

                <PageBlock column="main" blockId="charts">
                    {analytics && (
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-6">
                            <RevenueChart data={analytics.revenueOverTime} />
                            <OrdersChart data={analytics.orderCountOverTime} />
                        </div>
                    )}
                </PageBlock>

                <PageBlock column="main" blockId="tables">
                    {analytics && (
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-6">
                            <TopProductsTable data={analytics.topProducts} />
                            <TopCustomersTable data={analytics.topCustomers} />
                        </div>
                    )}
                </PageBlock>

                <PageBlock column="main" blockId="collection-breakdown">
                    {analytics && (
                        <div className="mt-6">
                            <CategoryBreakdown data={analytics.categoryBreakdown} />
                        </div>
                    )}
                </PageBlock>

                <PageBlock column="main" blockId="ai-insights">
                    <div className="mt-6">
                        <AiInsightsCard startDate={startDate} endDate={endDate} />
                    </div>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
