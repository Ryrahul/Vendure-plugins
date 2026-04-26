/**
 * Configuration options for OrderExportPlugin.
 */
export interface OrderExportPluginOptions {
    /**
     * Enable AI-powered insights on exports. Requires the `openai` package
     * to be installed.
     * @default false
     */
    enableAiInsights?: boolean;

    /**
     * OpenAI API key. Required if `enableAiInsights` is true.
     */
    openAiApiKey?: string;

    /**
     * OpenAI model to use for generating insights.
     * @default 'gpt-4o-mini'
     */
    openAiModel?: string;

    /**
     * Email address to send scheduled reports FROM.
     * Used with the Vendure EmailPlugin.
     */
    reportSenderEmail?: string;

    /**
     * Maximum number of orders per export to prevent memory issues.
     * @default 10000
     */
    maxExportRows?: number;
}

// --- GraphQL input/args types are generated via codegen ---
// Import from './generated-graphql-types' instead of defining manually.
// To regenerate: npm run generate
