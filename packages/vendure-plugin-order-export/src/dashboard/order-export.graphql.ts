import { graphql } from '@/gql';

// ── Fragments ──

const exportReportFragment = graphql(`
    fragment ExportReportFragment on ExportReport {
        id
        createdAt
        updatedAt
        type
        status
        fileName
        orderCount
        aiInsight
        filters
        error
    }
`);

const reportScheduleFragment = graphql(`
    fragment ReportScheduleFragment on ReportSchedule {
        id
        createdAt
        updatedAt
        name
        enabled
        frequency
        exportFormat
        recipientEmails
        filters
        includeAiInsights
        lastRunAt
    }
`);

// ── Export Report Queries / Mutations ──

export const getExportReportsQuery = graphql(
    `
        query GetExportReports($options: ExportReportListOptions) {
            exportReports(options: $options) {
                items {
                    ...ExportReportFragment
                }
                totalItems
            }
        }
    `,
    [exportReportFragment],
);

export const getExportReportQuery = graphql(
    `
        query GetExportReport($id: ID!) {
            exportReport(id: $id) {
                ...ExportReportFragment
            }
        }
    `,
    [exportReportFragment],
);

export const createExportReportMutation = graphql(
    `
        mutation CreateExportReport($input: CreateExportReportInput!) {
            createExportReport(input: $input) {
                ...ExportReportFragment
            }
        }
    `,
    [exportReportFragment],
);

export const deleteExportReportMutation = graphql(`
    mutation DeleteExportReport($id: ID!) {
        deleteExportReport(id: $id) {
            result
            message
        }
    }
`);

// ── Report Schedule Queries / Mutations ──

export const getReportSchedulesQuery = graphql(
    `
        query GetReportSchedules($options: ReportScheduleListOptions) {
            reportSchedules(options: $options) {
                items {
                    ...ReportScheduleFragment
                }
                totalItems
            }
        }
    `,
    [reportScheduleFragment],
);

export const getReportScheduleQuery = graphql(
    `
        query GetReportSchedule($id: ID!) {
            reportSchedule(id: $id) {
                ...ReportScheduleFragment
            }
        }
    `,
    [reportScheduleFragment],
);

export const createReportScheduleMutation = graphql(
    `
        mutation CreateReportSchedule($input: CreateReportScheduleInput!) {
            createReportSchedule(input: $input) {
                ...ReportScheduleFragment
            }
        }
    `,
    [reportScheduleFragment],
);

export const updateReportScheduleMutation = graphql(
    `
        mutation UpdateReportSchedule($input: UpdateReportScheduleInput!) {
            updateReportSchedule(input: $input) {
                ...ReportScheduleFragment
            }
        }
    `,
    [reportScheduleFragment],
);

export const deleteReportScheduleMutation = graphql(`
    mutation DeleteReportSchedule($id: ID!) {
        deleteReportSchedule(id: $id) {
            result
            message
        }
    }
`);

export const toggleReportScheduleMutation = graphql(
    `
        mutation ToggleReportSchedule($id: ID!) {
            toggleReportSchedule(id: $id) {
                ...ReportScheduleFragment
            }
        }
    `,
    [reportScheduleFragment],
);

// ── Analytics ──

export const getOrderAnalyticsQuery = graphql(`
    query GetOrderAnalytics($input: AnalyticsInput!) {
        orderAnalytics(input: $input) {
            kpi {
                totalRevenue
                totalOrders
                averageOrderValue
                repeatCustomerRate
            }
            revenueOverTime {
                date
                value
            }
            orderCountOverTime {
                date
                value
            }
            topProducts {
                productId
                productName
                totalRevenue
                totalQuantity
            }
            topCustomers {
                customerId
                customerName
                customerEmail
                totalSpent
                orderCount
            }
            categoryBreakdown {
                category
                revenue
                percentage
            }
        }
    }
`);

export const generateAiInsightQuery = graphql(`
    query GenerateAiInsight($input: AnalyticsInput!) {
        generateAiInsight(input: $input)
    }
`);
