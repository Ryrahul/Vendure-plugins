import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    enum ExportFormat {
        CSV
        EXCEL
        PDF
    }

    enum ExportStatus {
        PENDING
        PROCESSING
        COMPLETED
        FAILED
    }

    enum ScheduleFrequency {
        DAILY
        WEEKLY
        MONTHLY
    }

    enum AnalyticsGranularity {
        DAY
        WEEK
        MONTH
    }

    type ExportReport implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        type: ExportFormat!
        status: ExportStatus!
        fileName: String!
        orderCount: Int!
        aiInsight: String
        filters: JSON
        error: String
    }

    type ExportReportList implements PaginatedList {
        items: [ExportReport!]!
        totalItems: Int!
    }

    type ReportSchedule implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        enabled: Boolean!
        frequency: ScheduleFrequency!
        exportFormat: ExportFormat!
        recipientEmails: [String!]!
        filters: JSON
        includeAiInsights: Boolean!
        lastRunAt: DateTime
    }

    type ReportScheduleList implements PaginatedList {
        items: [ReportSchedule!]!
        totalItems: Int!
    }

    # Analytics types

    type AnalyticsKpi {
        totalRevenue: Money!
        totalOrders: Int!
        averageOrderValue: Money!
        repeatCustomerRate: Float!
    }

    type TimeSeriesDataPoint {
        date: String!
        value: Float!
    }

    type TopProduct {
        productId: ID!
        productName: String!
        totalRevenue: Money!
        totalQuantity: Int!
    }

    type TopCustomer {
        customerId: ID!
        customerName: String!
        customerEmail: String!
        totalSpent: Money!
        orderCount: Int!
    }

    type CategoryBreakdown {
        category: String!
        revenue: Money!
        percentage: Float!
    }

    type AnalyticsDashboard {
        kpi: AnalyticsKpi!
        revenueOverTime: [TimeSeriesDataPoint!]!
        orderCountOverTime: [TimeSeriesDataPoint!]!
        topProducts: [TopProduct!]!
        topCustomers: [TopCustomer!]!
        categoryBreakdown: [CategoryBreakdown!]!
    }

    # Inputs

    input ExportReportListOptions {
        take: Int
        skip: Int
    }

    input ReportScheduleListOptions {
        take: Int
        skip: Int
    }

    input OrderExportFiltersInput {
        startDate: DateTime
        endDate: DateTime
        orderStates: [String!]
    }

    input CreateExportReportInput {
        type: ExportFormat!
        filters: OrderExportFiltersInput
        includeAiInsights: Boolean
    }

    input CreateReportScheduleInput {
        name: String!
        frequency: ScheduleFrequency!
        exportFormat: ExportFormat!
        recipientEmails: [String!]!
        filters: JSON
        includeAiInsights: Boolean
    }

    input UpdateReportScheduleInput {
        id: ID!
        name: String
        frequency: ScheduleFrequency
        exportFormat: ExportFormat
        recipientEmails: [String!]
        filters: JSON
        includeAiInsights: Boolean
        enabled: Boolean
    }

    input AnalyticsInput {
        startDate: DateTime!
        endDate: DateTime!
        granularity: AnalyticsGranularity
    }

    extend type Query {
        exportReports: ExportReportList!
        exportReport(id: ID!): ExportReport
        reportSchedules: ReportScheduleList!
        reportSchedule(id: ID!): ReportSchedule
        orderAnalytics(input: AnalyticsInput!): AnalyticsDashboard!
        generateAiInsight(input: AnalyticsInput!): String
    }

    extend type Mutation {
        createExportReport(input: CreateExportReportInput!): ExportReport!
        deleteExportReport(id: ID!): DeletionResponse!
        createReportSchedule(input: CreateReportScheduleInput!): ReportSchedule!
        updateReportSchedule(input: UpdateReportScheduleInput!): ReportSchedule!
        deleteReportSchedule(id: ID!): DeletionResponse!
        toggleReportSchedule(id: ID!): ReportSchedule!
    }
`;
