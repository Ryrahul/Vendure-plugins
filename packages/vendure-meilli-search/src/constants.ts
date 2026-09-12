export const MEILISEARCH_OPTIONS = Symbol('MEILISEARCH_OPTIONS');
export const VARIANT_INDEX_NAME = 'variants';
export const loggerCtx = 'MeilisearchPlugin';

/**
 * Default timeout (ms) when waiting for a Meilisearch task to complete.
 * Overridable per-plugin via the `taskTimeout` option.
 */
export const DEFAULT_TASK_TIMEOUT_MS = 300_000;
