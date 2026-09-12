import { Logger } from '@vendure/core';
import { MeiliSearch } from 'meilisearch';

import { DEFAULT_TASK_TIMEOUT_MS, loggerCtx } from '../constants';
import { MeilisearchRuntimeOptions } from '../options';

/**
 * Expands a synonym map so that every word in a group maps to every other word
 * in that group (bidirectional). This means the user only needs to define
 * `laptop: ['notebook']` and the reverse `notebook: ['laptop']` is generated
 * automatically.
 *
 * Overlapping groups are merged and a word never maps to itself.
 */
export function expandSynonymsBidirectional(
    synonyms: Record<string, string[]>,
): Record<string, string[]> {
    const expanded: Record<string, Set<string>> = {};
    for (const [key, values] of Object.entries(synonyms)) {
        const group = [key, ...values];
        for (const word of group) {
            if (!expanded[word]) {
                expanded[word] = new Set();
            }
            for (const other of group) {
                if (other !== word) {
                    expanded[word].add(other);
                }
            }
        }
    }
    const result: Record<string, string[]> = {};
    for (const [word, synonymSet] of Object.entries(expanded)) {
        result[word] = Array.from(synonymSet);
    }
    return result;
}

/**
 * Poll interval used when waiting for Meilisearch tasks. The SDK default of 50ms
 * is unnecessarily chatty for the long-running tasks this plugin waits on.
 */
const TASK_POLL_INTERVAL_MS = 250;

/**
 * Waits for a Meilisearch task to complete, using the plugin's configured
 * `taskTimeout` rather than the SDK's 5 second default. Document batches — and
 * especially embedder-backed indexing, where Meilisearch calls the embedding
 * provider for every document — routinely take much longer than 5 seconds.
 */
export async function waitForTask(
    client: MeiliSearch,
    taskUid: number,
    options?: { taskTimeout?: number },
): Promise<void> {
    await client.tasks.waitForTask(taskUid, {
        timeout: options?.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS,
        interval: TASK_POLL_INTERVAL_MS,
    });
}

/**
 * Creates and returns a MeiliSearch client instance.
 */
export function getClient(options: Pick<MeilisearchRuntimeOptions, 'host' | 'apiKey'>): MeiliSearch {
    return new MeiliSearch({
        host: options.host,
        apiKey: options.apiKey,
    });
}

/**
 * Returns a sanitized index UID for Meilisearch.
 * Meilisearch only allows alphanumeric characters, hyphens, and underscores.
 */
export function getIndexUid(prefix: string, indexName: string): string {
    const raw = `${prefix}${indexName}`;
    return raw.replace(/\./g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Creates a Meilisearch index if it does not already exist.
 */
export async function createIndex(
    client: MeiliSearch,
    indexUid: string,
    primaryKey: string = 'id',
    options?: { taskTimeout?: number },
): Promise<void> {
    try {
        await client.getIndex(indexUid);
        Logger.verbose(`Index "${indexUid}" already exists`, loggerCtx);
    } catch (e: any) {
        Logger.verbose(`Index "${indexUid}" does not exist. Creating...`, loggerCtx);
        const task = await client.createIndex(indexUid, { primaryKey });
        await waitForTask(client, task.taskUid, options);
        Logger.verbose(`Created index "${indexUid}"`, loggerCtx);
    }
}

/**
 * Configures a Meilisearch index with filterable, searchable, sortable, displayed attributes,
 * and optional relevancy settings (synonyms, stop words, ranking rules, typo tolerance, embedders).
 */
export async function configureIndex(
    client: MeiliSearch,
    indexUid: string,
    options?: MeilisearchRuntimeOptions,
): Promise<void> {
    const index = client.index(indexUid);

    const filterableAttributes = [
        'channelId',
        'languageCode',
        'facetValueIds',
        'collectionIds',
        'collectionSlugs',
        'enabled',
        'productEnabled',
        'productId',
        'sku',
        'inStock',
        'productInStock',
        'price',
        'priceWithTax',
        'productPriceMin',
        'productPriceMax',
        'productPriceWithTaxMin',
        'productPriceWithTaxMax',
        'productFacetIds',
        'productFacetValueIds',
        'productCollectionIds',
        'productCollectionSlugs',
        'productChannelIds',
        'channelIds',
    ];

    const searchableAttributes = [
        'productName',
        'productVariantName',
        'description',
        'sku',
        'slug',
    ];

    const sortableAttributes = [
        'productName',
        'price',
        'priceWithTax',
        'productPriceMin',
        'productPriceMax',
    ];

    const displayedAttributes = ['*'];

    Logger.verbose(`Configuring index "${indexUid}"...`, loggerCtx);

    const filterTask = await index.updateFilterableAttributes(filterableAttributes);
    await waitForTask(client, filterTask.taskUid, options);

    const searchTask = await index.updateSearchableAttributes(searchableAttributes);
    await waitForTask(client, searchTask.taskUid, options);

    const sortTask = await index.updateSortableAttributes(sortableAttributes);
    await waitForTask(client, sortTask.taskUid, options);

    const displayTask = await index.updateDisplayedAttributes(displayedAttributes);
    await waitForTask(client, displayTask.taskUid, options);

    // ── Result limits ──
    //
    // Meilisearch caps `totalHits`/`estimatedTotalHits` at `pagination.maxTotalHits`
    // (default 1000) and facet distributions at `faceting.maxValuesPerFacet`
    // (default 100). Left at the defaults, a catalog larger than those numbers
    // silently reports truncated `totalItems` and facet counts, so both are derived
    // from the plugin's own searchConfig limits.
    const searchConfig = options?.searchConfig;
    if (searchConfig) {
        const paginationTask = await index.updatePagination({
            maxTotalHits: searchConfig.totalItemsMaxSize,
        });
        await waitForTask(client, paginationTask.taskUid, options);

        const facetingTask = await index.updateFaceting({
            maxValuesPerFacet: Math.max(
                searchConfig.facetValueMaxSize,
                searchConfig.collectionMaxSize,
            ),
        });
        await waitForTask(client, facetingTask.taskUid, options);
    }

    // ── Optional relevancy settings ──

    await applyOptionalSetting(client, indexUid, 'synonyms',
        options?.synonyms && Object.keys(options.synonyms).length > 0
            ? expandSynonymsBidirectional(options.synonyms)
            : undefined,
        value => index.updateSynonyms(value),
        options,
    );
    await applyOptionalSetting(client, indexUid, 'stop words',
        options?.stopWords?.length ? options.stopWords : undefined,
        value => index.updateStopWords(value),
        options,
    );
    await applyOptionalSetting(client, indexUid, 'ranking rules',
        options?.rankingRules?.length ? options.rankingRules : undefined,
        value => index.updateRankingRules(value),
        options,
    );

    if (options?.typoTolerance) {
        Logger.verbose(`Configuring typo tolerance on "${indexUid}"...`, loggerCtx);
        const typoSettings: any = {};
        if (options.typoTolerance.enabled !== undefined) {
            typoSettings.enabled = options.typoTolerance.enabled;
        }
        if (options.typoTolerance.minWordSizeForOneTypo || options.typoTolerance.minWordSizeForTwoTypos) {
            typoSettings.minWordSizeForTypos = {};
            if (options.typoTolerance.minWordSizeForOneTypo) {
                typoSettings.minWordSizeForTypos.oneTypo = options.typoTolerance.minWordSizeForOneTypo;
            }
            if (options.typoTolerance.minWordSizeForTwoTypos) {
                typoSettings.minWordSizeForTypos.twoTypos = options.typoTolerance.minWordSizeForTwoTypos;
            }
        }
        if (options.typoTolerance.disableOnWords) {
            typoSettings.disableOnWords = options.typoTolerance.disableOnWords;
        }
        if (options.typoTolerance.disableOnAttributes) {
            typoSettings.disableOnAttributes = options.typoTolerance.disableOnAttributes;
        }
        const typoTask = await index.updateTypoTolerance(typoSettings);
        await waitForTask(client, typoTask.taskUid, options);
    }

    // ── AI embedders ──
    //
    // Embedder settings are forwarded to Meilisearch, which owns the integration with
    // the embedding provider. A failure here is logged rather than thrown so that a
    // provider outage or a bad API key does not block the keyword index from being
    // built; hybrid search falls back to keyword search until the embedders apply.

    if (options?.ai?.embedders && Object.keys(options.ai.embedders).length > 0) {
        Logger.verbose(`Configuring AI embedders on "${indexUid}"...`, loggerCtx);
        const embedderSettings: Record<string, any> = {};
        for (const [name, config] of Object.entries(options.ai.embedders)) {
            const embedder: any = { source: config.source };
            if (config.model) embedder.model = config.model;
            if (config.apiKey) embedder.apiKey = config.apiKey;
            if (config.url) embedder.url = config.url;
            if (config.documentTemplate) embedder.documentTemplate = config.documentTemplate;
            if (config.documentTemplateMaxBytes) {
                embedder.documentTemplateMaxBytes = config.documentTemplateMaxBytes;
            }
            if (config.dimensions) embedder.dimensions = config.dimensions;
            if (config.request) embedder.request = config.request;
            if (config.response) embedder.response = config.response;
            if (config.headers) embedder.headers = config.headers;
            embedderSettings[name] = embedder;
        }
        try {
            const embedderTask = await index.updateEmbedders(embedderSettings);
            await waitForTask(client, embedderTask.taskUid, options);
            Logger.verbose(`AI embedders configured on "${indexUid}"`, loggerCtx);
        } catch (e: any) {
            Logger.error(
                `Could not configure AI embedders on "${indexUid}". Hybrid search will fall back to ` +
                    `keyword search and \`similarDocuments\` will fail until this is resolved. ` +
                    `Error: ${e.message as string}`,
                loggerCtx,
                e.stack,
            );
        }
    }

    Logger.verbose(`Index "${indexUid}" configured successfully`, loggerCtx);
}

/**
 * Applies an optional index setting if the value is defined.
 * Logs the operation and waits for the Meilisearch task to complete.
 */
async function applyOptionalSetting(
    client: MeiliSearch,
    indexUid: string,
    name: string,
    value: any,
    updaterFn: (value: any) => Promise<{ taskUid: number }>,
    options?: { taskTimeout?: number },
): Promise<void> {
    if (value === undefined || value === null) {
        return;
    }
    Logger.verbose(`Setting ${name} on "${indexUid}"...`, loggerCtx);
    const task = await updaterFn(value);
    await waitForTask(client, task.taskUid, options);
}
