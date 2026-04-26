export type Maybe<T> = T | undefined;
export type InputMaybe<T> = T | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  DateTime: { input: Date; output: Date; }
  JSON: { input: any; output: any; }
  LanguageCode: { input: import('@vendure/common/lib/generated-types').LanguageCode; output: import('@vendure/common/lib/generated-types').LanguageCode; }
  Money: { input: number; output: number; }
};

export type AnalyticsDashboard = {
  __typename?: 'AnalyticsDashboard';
  categoryBreakdown: Array<CategoryBreakdown>;
  kpi: AnalyticsKpi;
  orderCountOverTime: Array<TimeSeriesDataPoint>;
  revenueOverTime: Array<TimeSeriesDataPoint>;
  topCustomers: Array<TopCustomer>;
  topProducts: Array<TopProduct>;
};

export enum AnalyticsGranularity {
  DAY = 'DAY',
  MONTH = 'MONTH',
  WEEK = 'WEEK'
}

export type AnalyticsInput = {
  endDate: Scalars['DateTime']['input'];
  granularity?: InputMaybe<AnalyticsGranularity>;
  startDate: Scalars['DateTime']['input'];
};

export type AnalyticsKpi = {
  __typename?: 'AnalyticsKpi';
  averageOrderValue: Scalars['Money']['output'];
  repeatCustomerRate: Scalars['Float']['output'];
  totalOrders: Scalars['Int']['output'];
  totalRevenue: Scalars['Money']['output'];
};

export type CategoryBreakdown = {
  __typename?: 'CategoryBreakdown';
  category: Scalars['String']['output'];
  percentage: Scalars['Float']['output'];
  revenue: Scalars['Money']['output'];
};

export type CreateExportReportInput = {
  filters?: InputMaybe<OrderExportFiltersInput>;
  includeAiInsights?: InputMaybe<Scalars['Boolean']['input']>;
  type: ExportFormat;
};

export type CreateReportScheduleInput = {
  exportFormat: ExportFormat;
  filters?: InputMaybe<Scalars['JSON']['input']>;
  frequency: ScheduleFrequency;
  includeAiInsights?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  recipientEmails: Array<Scalars['String']['input']>;
};

export type DeletionResponse = {
  __typename?: 'DeletionResponse';
  message?: Maybe<Scalars['String']['output']>;
  result: DeletionResult;
};

export enum DeletionResult {
  DELETED = 'DELETED',
  NOT_DELETED = 'NOT_DELETED'
}

export enum ExportFormat {
  CSV = 'CSV',
  EXCEL = 'EXCEL',
  PDF = 'PDF'
}

export type ExportReport = Node & {
  __typename?: 'ExportReport';
  aiInsight?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  error?: Maybe<Scalars['String']['output']>;
  fileName: Scalars['String']['output'];
  filters?: Maybe<Scalars['JSON']['output']>;
  id: Scalars['ID']['output'];
  orderCount: Scalars['Int']['output'];
  status: ExportStatus;
  type: ExportFormat;
  updatedAt: Scalars['DateTime']['output'];
};

export type ExportReportList = PaginatedList & {
  __typename?: 'ExportReportList';
  items: Array<ExportReport>;
  totalItems: Scalars['Int']['output'];
};

export type ExportReportListOptions = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export enum ExportStatus {
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING'
}

export type Mutation = {
  __typename?: 'Mutation';
  createExportReport: ExportReport;
  createReportSchedule: ReportSchedule;
  deleteExportReport: DeletionResponse;
  deleteReportSchedule: DeletionResponse;
  toggleReportSchedule: ReportSchedule;
  updateReportSchedule: ReportSchedule;
};


export type MutationCreateExportReportArgs = {
  input: CreateExportReportInput;
};


export type MutationCreateReportScheduleArgs = {
  input: CreateReportScheduleInput;
};


export type MutationDeleteExportReportArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteReportScheduleArgs = {
  id: Scalars['ID']['input'];
};


export type MutationToggleReportScheduleArgs = {
  id: Scalars['ID']['input'];
};


export type MutationUpdateReportScheduleArgs = {
  input: UpdateReportScheduleInput;
};

export type Node = {
  id: Scalars['ID']['output'];
};

export type OrderExportFiltersInput = {
  endDate?: InputMaybe<Scalars['DateTime']['input']>;
  orderStates?: InputMaybe<Array<Scalars['String']['input']>>;
  startDate?: InputMaybe<Scalars['DateTime']['input']>;
};

export type PaginatedList = {
  items: Array<Node>;
  totalItems: Scalars['Int']['output'];
};

export type Query = {
  __typename?: 'Query';
  exportReport?: Maybe<ExportReport>;
  exportReports: ExportReportList;
  generateAiInsight?: Maybe<Scalars['String']['output']>;
  orderAnalytics: AnalyticsDashboard;
  reportSchedule?: Maybe<ReportSchedule>;
  reportSchedules: ReportScheduleList;
};


export type QueryExportReportArgs = {
  id: Scalars['ID']['input'];
};


export type QueryGenerateAiInsightArgs = {
  input: AnalyticsInput;
};


export type QueryOrderAnalyticsArgs = {
  input: AnalyticsInput;
};


export type QueryReportScheduleArgs = {
  id: Scalars['ID']['input'];
};

export type ReportSchedule = Node & {
  __typename?: 'ReportSchedule';
  createdAt: Scalars['DateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  exportFormat: ExportFormat;
  filters?: Maybe<Scalars['JSON']['output']>;
  frequency: ScheduleFrequency;
  id: Scalars['ID']['output'];
  includeAiInsights: Scalars['Boolean']['output'];
  lastRunAt?: Maybe<Scalars['DateTime']['output']>;
  name: Scalars['String']['output'];
  recipientEmails: Array<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type ReportScheduleList = PaginatedList & {
  __typename?: 'ReportScheduleList';
  items: Array<ReportSchedule>;
  totalItems: Scalars['Int']['output'];
};

export type ReportScheduleListOptions = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export enum ScheduleFrequency {
  DAILY = 'DAILY',
  MONTHLY = 'MONTHLY',
  WEEKLY = 'WEEKLY'
}

export type TimeSeriesDataPoint = {
  __typename?: 'TimeSeriesDataPoint';
  date: Scalars['String']['output'];
  value: Scalars['Float']['output'];
};

export type TopCustomer = {
  __typename?: 'TopCustomer';
  customerEmail: Scalars['String']['output'];
  customerId: Scalars['ID']['output'];
  customerName: Scalars['String']['output'];
  orderCount: Scalars['Int']['output'];
  totalSpent: Scalars['Money']['output'];
};

export type TopProduct = {
  __typename?: 'TopProduct';
  productId: Scalars['ID']['output'];
  productName: Scalars['String']['output'];
  totalQuantity: Scalars['Int']['output'];
  totalRevenue: Scalars['Money']['output'];
};

export type UpdateReportScheduleInput = {
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  exportFormat?: InputMaybe<ExportFormat>;
  filters?: InputMaybe<Scalars['JSON']['input']>;
  frequency?: InputMaybe<ScheduleFrequency>;
  id: Scalars['ID']['input'];
  includeAiInsights?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  recipientEmails?: InputMaybe<Array<Scalars['String']['input']>>;
};
