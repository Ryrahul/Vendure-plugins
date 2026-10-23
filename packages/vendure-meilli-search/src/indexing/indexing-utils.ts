import { Logger } from '@vendure/core';
import { Meilisearch, MeilisearchApiError } from 'meilisearch';
import type { FilterableAttributes, Settings, Task } from 'meilisearch';

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

/** Thrown when a Meilisearch task finishes as `failed` or `canceled`. */
export class MeilisearchTaskFailedError extends Error {
    constructor(readonly task: Task) {
        super(
            `Meilisearch task ${task.uid} (${task.type}) ${task.status}` +
                (task.error ? `: [${task.error.code}] ${task.error.message}` : ''),
        );
        this.name = 'MeilisearchTaskFailedError';
    }
}

/**
 * Waits for a Meilisearch task to finish and throws if it failed.
 *
 * The SDK's `waitForTask` resolves for failed tasks too (it only rejects on timeout), so the
 * status has to be checked: otherwise a rejected document batch or settings update would be
 * treated as a success and the index silently left incomplete.
 *
 * Uses the plugin's `taskTimeout` rather than the SDK's 5 second default: document batches,
 * and especially embedder-backed indexing, routinely take longer than that.
 */
export async function waitForTask(
    client: Meilisearch,
    taskUid: number,
    options?: { taskTimeout?: number },
): Promise<Task> {
    const task = await client.tasks.waitForTask(taskUid, {
        timeout: options?.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS,
        interval: TASK_POLL_INTERVAL_MS,
    });
    if (task.status !== 'succeeded') {
        throw new MeilisearchTaskFailedError(task);
    }
    return task;
}

/** Waits for several tasks (e.g. the document batches of a reindex); throws on the first failure. */
export async function waitForTasks(
    client: Meilisearch,
    taskUids: number[],
    options?: { taskTimeout?: number },
): Promise<void> {
    for (const uid of taskUids) {
        await waitForTask(client, uid, options);
    }
}

/**
 * Creates and returns a Meilisearch client instance.
 */
export function getClient(options: Pick<MeilisearchRuntimeOptions, 'host' | 'apiKey'>): Meilisearch {
    return new Meilisearch({
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

/** `true` if the error is Meilisearch's "index not found". */
export function isIndexNotFound(e: unknown): boolean {
    return e instanceof MeilisearchApiError && e.cause?.code === 'index_not_found';
}

/** `true` if the error says the embedder used in a search doesn't exist (yet) on the index. */
export function isMissingEmbedder(e: unknown): boolean {
    return (
        e instanceof MeilisearchApiError &&
        (e.cause?.code === 'invalid_search_embedder' || e.cause?.code === 'invalid_similar_embedder')
    );
}

/**
 * Creates a Meilisearch index if it does not already exist. Returns `true` if it was created.
 * Errors other than "index not found" (network, invalid API key…) are rethrown instead of
 * being mistaken for a missing index.
 */
export async function createIndex(
    client: Meilisearch,
    indexUid: string,
    primaryKey: string = 'id',
    options?: { taskTimeout?: number },
): Promise<boolean> {
    try {
        await client.getIndex(indexUid);
        Logger.verbose(`Index "${indexUid}" already exists`, loggerCtx);
        return false;
    } catch (e: any) {
        if (!isIndexNotFound(e)) {
            throw e;
        }
        Logger.verbose(`Index "${indexUid}" does not exist. Creating...`, loggerCtx);
        const task = await client.createIndex(indexUid, { primaryKey });
        await waitForTask(client, task.taskUid, options);
        Logger.verbose(`Created index "${indexUid}"`, loggerCtx);
        return true;
    }
}

/** Attributes the plugin filters on by exact value (ids, slugs, flags). */
const EQUALITY_FILTER_ATTRIBUTES = [
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
    'productFacetIds',
    'productFacetValueIds',
    'productCollectionIds',
    'productCollectionSlugs',
    'productChannelIds',
    'channelIds',
    'productAssetId',
    'productVariantAssetId',
];

/** Attributes the plugin filters on by range (prices). */
const RANGE_FILTER_ATTRIBUTES = [
    'price',
    'priceWithTax',
    'productPriceMin',
    'productPriceMax',
    'productPriceWithTaxMin',
    'productPriceWithTaxMax',
];

const SEARCHABLE_ATTRIBUTES = ['productName', 'productVariantName', 'description', 'sku', 'slug'];
const SORTABLE_ATTRIBUTES = ['productName', 'price', 'priceWithTax', 'productPriceMin', 'productPriceMax'];

/**
 * Meilisearch's default ranking rules, which differ between engine versions (`attribute` was later
 * split into `attributeRank` and `wordPosition`). When no ranking rules are configured the plugin
 * sends `null`, which resets them to the engine's own default, and treats any of these as default.
 */
const DEFAULT_RANKING_RULES = [
    ['words', 'typo', 'proximity', 'attributeRank', 'sort', 'wordPosition', 'exactness'],
    ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
];
/** Meilisearch's defaults, used to reset options that were removed from the plugin config. */
const DEFAULT_MIN_WORD_SIZE_ONE_TYPO = 5;
const DEFAULT_MIN_WORD_SIZE_TWO_TYPOS = 9;

/** Granular filterable attributes (per-attribute filter features) exist since Meilisearch v1.14. */
export function supportsGranularFilters(engineVersion: string | undefined): boolean {
    const [major, minor] = (engineVersion ?? '0.0').split('.').map(Number);
    return major > 1 || (major === 1 && minor >= 14);
}

/**
 * Filterable attributes. On Meilisearch v1.14+ each attribute enables only the filter features
 * it needs — ids and flags are matched by equality only, prices also by comparison, and none
 * need facet search — which makes indexing cheaper. Older engines get the plain list.
 */
export function buildFilterableAttributes(
    engineVersion: string | undefined,
    extra: FilterableAttributes = [],
): FilterableAttributes {
    if (!supportsGranularFilters(engineVersion)) {
        return Array.from(new Set([...EQUALITY_FILTER_ATTRIBUTES, ...RANGE_FILTER_ATTRIBUTES, ...(extra ?? [])])) as FilterableAttributes;
    }
    return [
        {
            attributePatterns: EQUALITY_FILTER_ATTRIBUTES,
            features: { facetSearch: false, filter: { equality: true, comparison: false } },
        },
        {
            attributePatterns: RANGE_FILTER_ATTRIBUTES,
            features: { facetSearch: false, filter: { equality: true, comparison: true } },
        },
        ...(extra ?? []),
    ] as FilterableAttributes;
}

/**
 * The complete settings the plugin wants on its index. Every setting the plugin manages is
 * included, and options removed from the config map to Meilisearch's defaults — so e.g.
 * deleting `synonyms` from the config really removes them from the index.
 *
 * `indexSettings` from the options is merged on top; lists the plugin depends on
 * (filterable, searchable, sortable attributes) are extended rather than replaced.
 */
export function buildIndexSettings(options: MeilisearchRuntimeOptions, engineVersion?: string): Settings {
    const custom = options.indexSettings ?? {};
    const searchConfig = options.searchConfig;
    const typo = options.typoTolerance;

    const typoTolerance: NonNullable<Settings['typoTolerance']> = {
        enabled: typo?.enabled ?? true,
        minWordSizeForTypos: {
            oneTypo: typo?.minWordSizeForOneTypo ?? DEFAULT_MIN_WORD_SIZE_ONE_TYPO,
            twoTypos: typo?.minWordSizeForTwoTypos ?? DEFAULT_MIN_WORD_SIZE_TWO_TYPOS,
        },
        disableOnWords: typo?.disableOnWords ?? [],
        disableOnAttributes: typo?.disableOnAttributes ?? [],
    };
    if (typo?.disableOnNumbers !== undefined) {
        (typoTolerance as any).disableOnNumbers = typo.disableOnNumbers;
    }

    const settings: Settings = {
        ...custom,
        filterableAttributes: buildFilterableAttributes(engineVersion, custom.filterableAttributes ?? []),
        searchableAttributes: Array.from(new Set([...SEARCHABLE_ATTRIBUTES, ...(custom.searchableAttributes ?? [])])),
        sortableAttributes: Array.from(new Set([...SORTABLE_ATTRIBUTES, ...(custom.sortableAttributes ?? [])])),
        displayedAttributes: custom.displayedAttributes ?? ['*'],
        // Meilisearch caps totals at `pagination.maxTotalHits` (default 1000) and facet
        // distributions at `faceting.maxValuesPerFacet` (default 100). Left at the defaults, a
        // larger catalog would report truncated totals and facet counts, so both follow the
        // plugin's own limits. Facet values are sorted by count, so that truncation keeps the
        // most frequent values rather than the first ones alphabetically.
        pagination: { maxTotalHits: searchConfig.totalItemsMaxSize, ...(custom.pagination ?? {}) },
        faceting: {
            maxValuesPerFacet: Math.max(searchConfig.facetValueMaxSize, searchConfig.collectionMaxSize),
            sortFacetValuesBy: { '*': 'count' },
            ...(custom.faceting ?? {}),
        },
        synonyms:
            options.synonyms && Object.keys(options.synonyms).length
                ? expandSynonymsBidirectional(options.synonyms)
                : (custom.synonyms ?? {}),
        stopWords: options.stopWords?.length ? options.stopWords : (custom.stopWords ?? []),
        rankingRules: options.rankingRules?.length ? options.rankingRules : (custom.rankingRules ?? null),
        typoTolerance: { ...typoTolerance, ...(custom.typoTolerance ?? {}) },
    };

    const embedders = buildEmbedders(options);
    if (embedders) {
        settings.embedders = embedders;
    }
    return settings;
}

/**
 * Embedder settings are forwarded to Meilisearch, which owns the integration with the
 * embedding provider.
 */
function buildEmbedders(options: MeilisearchRuntimeOptions): Record<string, any> | undefined {
    if (!options.ai?.embedders || !Object.keys(options.ai.embedders).length) {
        return undefined;
    }
    const embedders: Record<string, any> = {};
    for (const [name, config] of Object.entries(options.ai.embedders)) {
        const embedder: any = { source: config.source };
        if (config.model) embedder.model = config.model;
        if (config.apiKey) embedder.apiKey = config.apiKey;
        if (config.url) embedder.url = config.url;
        if (config.documentTemplate) embedder.documentTemplate = config.documentTemplate;
        if (config.documentTemplateMaxBytes) embedder.documentTemplateMaxBytes = config.documentTemplateMaxBytes;
        if (config.dimensions) embedder.dimensions = config.dimensions;
        if (config.request) embedder.request = config.request;
        if (config.response) embedder.response = config.response;
        if (config.headers) embedder.headers = config.headers;
        embedders[name] = embedder;
    }
    return embedders;
}

/** Settings whose value is a list where order doesn't matter. */
const UNORDERED_SETTINGS = new Set([
    'filterableAttributes',
    'sortableAttributes',
    'stopWords',
    'separatorTokens',
    'nonSeparatorTokens',
    'dictionary',
]);
/** Object settings that Meilisearch completes with defaults for the keys that weren't sent. */
const PARTIAL_SETTINGS = new Set(['typoTolerance', 'faceting', 'pagination']);

/**
 * The part of `desired` that differs from `current` (the index's live settings).
 *
 * - `typoTolerance`, `faceting` and `pagination` are compared on the keys the plugin sets;
 *   Meilisearch fills in the rest. Other settings must match exactly.
 * - Unordered lists (filterable/sortable attributes, stop words, synonyms) are compared as sets.
 * - Embedder API keys are returned masked by Meilisearch, so they're left out of the comparison.
 *   Embedders that exist on the index but not in the config are removed (set to `null`).
 */
export function diffSettings(desired: Settings, current: Settings): Settings {
    const changed: Record<string, any> = {};
    for (const key of Object.keys(desired)) {
        const want = (desired as any)[key];
        const have = (current as any)[key];
        if (key === 'embedders') {
            const embedderChanges: Record<string, any> = {};
            for (const [name, config] of Object.entries(want ?? {})) {
                const { apiKey: _apiKey, ...comparable } = config as any;
                if (!have?.[name] || !isSubset(comparable, have[name])) {
                    embedderChanges[name] = config;
                }
            }
            if (Object.keys(embedderChanges).length) {
                changed.embedders = embedderChanges;
            }
            continue;
        }
        let same: boolean;
        if (UNORDERED_SETTINGS.has(key)) {
            same = sameSet(want, have);
        } else if (key === 'rankingRules' && want === null) {
            same = DEFAULT_RANKING_RULES.some(rules => canonical(rules) === canonical(have));
        } else if (key === 'synonyms') {
            same = canonical(sortedValues(want)) === canonical(sortedValues(have));
        } else if (PARTIAL_SETTINGS.has(key)) {
            same = isSubset(want, have);
        } else {
            same = canonical(want) === canonical(have);
        }
        if (!same) {
            changed[key] = want;
        }
    }
    // Embedders removed from the config
    const staleEmbedders = Object.keys((current as any).embedders ?? {}).filter(
        name => !(desired as any).embedders?.[name],
    );
    if (staleEmbedders.length) {
        changed.embedders = changed.embedders ?? {};
        for (const name of staleEmbedders) {
            changed.embedders[name] = null;
        }
    }
    return changed as Settings;
}

/**
 * Brings the index's settings in line with the plugin config. Each settings update can make
 * Meilisearch re-index, so the changes go out in **one** task, and nothing at all is sent when
 * the live settings already match.
 *
 * Embedders get a task of their own, so that an embedding-provider problem (a bad key, an
 * unreachable URL) can't block the keyword settings. Such a failure is logged, not thrown:
 * hybrid search falls back to keyword search until it's fixed.
 *
 * Returns the uids of the enqueued tasks (empty when nothing changed). With `wait: false` the
 * tasks are only enqueued, which is used at bootstrap so startup isn't blocked by a re-index.
 */
export async function applyIndexSettings(
    client: Meilisearch,
    indexUid: string,
    options: MeilisearchRuntimeOptions,
    { wait = true }: { wait?: boolean } = {},
): Promise<number[]> {
    const index = client.index(indexUid);
    const engineVersion = await getEngineVersion(client);
    const desired = buildIndexSettings(options, engineVersion);
    const current = await index.getSettings();
    const { embedders, ...changes } = diffSettings(desired, current);
    const taskUids: number[] = [];

    if (Object.keys(changes).length) {
        Logger.verbose(`Updating settings of "${indexUid}": ${Object.keys(changes).join(', ')}`, loggerCtx);
        const task = await index.updateSettings(changes);
        taskUids.push(task.taskUid);
        if (wait) {
            await waitForTask(client, task.taskUid, options);
        }
    }

    if (embedders) {
        Logger.verbose(`Updating AI embedders on "${indexUid}"`, loggerCtx);
        try {
            const task = await index.updateSettings({ embedders });
            taskUids.push(task.taskUid);
            if (wait) {
                await waitForTask(client, task.taskUid, options);
            }
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

    if (!taskUids.length) {
        Logger.verbose(`Settings of "${indexUid}" are up to date`, loggerCtx);
    }
    return taskUids;
}

/** Configures an index and waits until its settings are applied. */
export async function configureIndex(
    client: Meilisearch,
    indexUid: string,
    options: MeilisearchRuntimeOptions,
): Promise<void> {
    await applyIndexSettings(client, indexUid, options, { wait: true });
    Logger.verbose(`Index "${indexUid}" configured successfully`, loggerCtx);
}

const engineVersions = new WeakMap<Meilisearch, Promise<string | undefined>>();

/** The Meilisearch engine version (e.g. "1.55.0"), or undefined if the API key can't read it. */
export function getEngineVersion(client: Meilisearch): Promise<string | undefined> {
    let version = engineVersions.get(client);
    if (!version) {
        version = client.getVersion().then(
            v => v.pkgVersion,
            () => undefined,
        );
        engineVersions.set(client, version);
    }
    return version;
}

function sortedValues(synonyms: Record<string, string[]> | null | undefined): Record<string, string[]> {
    return Object.fromEntries(Object.entries(synonyms ?? {}).map(([word, values]) => [word, [...values].sort()]));
}

function sameSet(a: unknown, b: unknown): boolean {
    if (!Array.isArray(a) || !Array.isArray(b)) {
        return canonical(a) === canonical(b);
    }
    return canonical(a.map(canonical).sort()) === canonical(b.map(canonical).sort());
}

/** Order-independent serialization of objects (key order), for comparisons. */
function canonical(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map(k => `${k}:${canonical((value as any)[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
}

/** Every key set in `want` has the same value in `have` (recursively for objects; lists exactly). */
function isSubset(want: unknown, have: unknown): boolean {
    if (Array.isArray(want)) {
        return canonical(want) === canonical(have);
    }
    if (want && typeof want === 'object') {
        if (!have || typeof have !== 'object') {
            return false;
        }
        return Object.entries(want).every(([k, v]) => isSubset(v, (have as any)[k]));
    }
    return want === have;
}
