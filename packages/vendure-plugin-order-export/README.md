# @rahul_vendure/vendure-plugin-order-export

Automated order export, reporting, analytics dashboard, and AI-powered insights for Vendure.

## Features

- **Order Export** — Export orders to CSV, Excel, or PDF with filtering by date range and order state
- **Analytics Dashboard** — Full analytics with revenue charts, order trends, top products, top customers, and category breakdown (uses Recharts)
- **Scheduled Reports** — Configure daily, weekly, or monthly automated exports with email delivery via Vendure EmailPlugin
- **AI Insights** — Optional OpenAI-powered summaries of order data with trends and recommendations
- **REST Download** — File download endpoint at `/order-export/download/:id`

## Requirements

- Vendure `^3.3.0` (uses `DefaultSchedulerPlugin` for scheduled tasks)
- PostgreSQL (analytics queries use `DATE_TRUNC`)
- `DefaultSchedulerPlugin` must be registered in your Vendure config
- `recharts` must be installed in your project (dashboard dependency)

## Installation

```bash
npm install @rahul_vendure/vendure-plugin-order-export
npm install recharts  # required for dashboard charts
```

## Setup

### 1. Add to Vendure config

```ts
import { OrderExportPlugin } from '@rahul_vendure/vendure-plugin-order-export';

export const config: VendureConfig = {
    plugins: [
        DefaultSchedulerPlugin.init(),
        OrderExportPlugin.init({
            // Optional: enable AI insights
            enableAiInsights: true,
            openAiApiKey: process.env.OPENAI_API_KEY,
            openAiModel: 'gpt-4o-mini',          // default
            maxExportRows: 10000,                  // default
        }),
    ],
};
```

### 2. Run migrations

This plugin introduces 2 new database tables (`ExportReport`, `ReportSchedule`). After adding the plugin, generate and run a migration:

```bash
npx vendure migrate
```

### 3. Email reports (optional)

To receive scheduled reports via email, add the email handler to your EmailPlugin config:

```ts
import { reportGeneratedHandler } from '@rahul_vendure/vendure-plugin-order-export';

EmailPlugin.init({
    handlers: [...defaultEmailHandlers, reportGeneratedHandler],
    // ...
}),
```

Then create a template at `<your-template-dir>/order-export-report/body.mjml`. Available template variables:

| Variable | Type | Description |
|----------|------|-------------|
| `schedule.name` | string | Schedule name |
| `schedule.frequency` | string | DAILY / WEEKLY / MONTHLY |
| `schedule.exportFormat` | string | CSV / EXCEL / PDF |
| `report.fileName` | string | Export file name |
| `report.orderCount` | number | Number of orders exported |
| `report.aiInsight` | string | AI-generated summary (if enabled) |

## Dashboard

The plugin adds an **Order Analytics** section to the Vendure dashboard with three pages:

### Dashboard
- KPI cards (total revenue, orders, avg order value, repeat customer rate)
- Revenue over time (area chart)
- Order count over time (bar chart)
- Top 10 products by revenue
- Top 10 customers by spend
- Revenue by category (pie chart)
- AI insights card (click to generate)

### Export Reports
- List of all generated exports
- Create new exports (CSV / Excel / PDF)
- Download completed exports

### Report Schedules
- Create and manage automated report schedules
- Toggle schedules on/off
- Configure frequency, format, and recipients

## Permissions

| Permission | Description |
|-----------|-------------|
| `ExportOrders` | View analytics, create/download exports |
| `ManageReportSchedules` | Create, edit, delete report schedules |

## Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableAiInsights` | boolean | `false` | Enable OpenAI-powered insights |
| `openAiApiKey` | string | `''` | OpenAI API key |
| `openAiModel` | string | `'gpt-4o-mini'` | OpenAI model |
| `reportSenderEmail` | string | `''` | FROM address for report emails |
| `maxExportRows` | number | `10000` | Max orders per export |

## Architecture

```
src/
├── order-export.plugin.ts     # Plugin definition
├── entities/
│   ├── export-report.entity.ts
│   └── report-schedule.entity.ts
├── services/
│   ├── order-export.service.ts      # Order querying + data transform
│   ├── analytics.service.ts         # Dashboard analytics queries
│   ├── export-generator.service.ts  # CSV / Excel / PDF generation
│   ├── ai-insight.service.ts        # OpenAI integration
│   └── report-scheduler.service.ts  # Schedule management + execution
├── api/
│   ├── api-extensions.ts            # GraphQL schema
│   ├── admin.resolver.ts            # Admin API resolver
│   └── export-download.controller.ts # REST file download
├── events/
│   └── report-generated.event.ts    # Custom event for email
├── scheduled-tasks/
│   └── report-generation.task.ts    # Vendure ScheduledTask (hourly)
├── email/
│   └── report-generated.handler.ts  # EmailPlugin handler
└── dashboard/                       # React dashboard extension
    ├── index.tsx
    ├── analytics-dashboard.tsx
    ├── export-list.tsx
    ├── schedule-list.tsx
    └── components/
        ├── stats-cards.tsx
        ├── revenue-chart.tsx
        ├── orders-chart.tsx
        ├── top-products-table.tsx
        ├── top-customers-table.tsx
        ├── category-breakdown.tsx
        └── ai-insights-card.tsx
```

## License

MIT
