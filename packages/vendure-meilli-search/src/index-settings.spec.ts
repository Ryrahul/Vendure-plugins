import { describe, expect, it } from 'vitest';

import {
    buildFilterableAttributes,
    buildIndexSettings,
    diffSettings,
    supportsGranularFilters,
} from './indexing/indexing-utils';
import { mergeWithDefaults } from './options';

describe('supportsGranularFilters()', () => {
    it('is true from Meilisearch 1.14', () => {
        expect(supportsGranularFilters('1.14.0')).toBe(true);
        expect(supportsGranularFilters('1.55.0')).toBe(true);
        expect(supportsGranularFilters('2.0.0')).toBe(true);
    });

    it('is false for older or unknown versions', () => {
        expect(supportsGranularFilters('1.13.3')).toBe(false);
        expect(supportsGranularFilters(undefined)).toBe(false);
    });
});

describe('buildFilterableAttributes()', () => {
    it('uses plain names on old engines, including the asset ids', () => {
        const attributes = buildFilterableAttributes('1.13.0') as string[];
        expect(attributes).toEqual(expect.arrayContaining(['productId', 'productAssetId', 'productVariantAssetId', 'price']));
        expect(attributes.every(a => typeof a === 'string')).toBe(true);
    });

    it('uses equality-only filters for ids and comparison filters for prices on new engines', () => {
        const [equality, range] = buildFilterableAttributes('1.55.0') as any[];
        expect(equality.attributePatterns).toContain('productAssetId');
        expect(equality.features).toEqual({ facetSearch: false, filter: { equality: true, comparison: false } });
        expect(range.attributePatterns).toContain('priceWithTax');
        expect(range.features.filter.comparison).toBe(true);
    });

    it('appends extra attributes', () => {
        expect(buildFilterableAttributes('1.55.0', ['brand'])).toContain('brand');
        expect(buildFilterableAttributes('1.13.0', ['brand'])).toContain('brand');
    });
});

describe('buildIndexSettings()', () => {
    it('resets optional settings to Meilisearch defaults when they are not configured', () => {
        const settings = buildIndexSettings(mergeWithDefaults({}), '1.55.0');
        expect(settings.synonyms).toEqual({});
        expect(settings.stopWords).toEqual([]);
        // null resets to the engine's default, which differs between Meilisearch versions
        expect(settings.rankingRules).toBeNull();
        expect(settings.typoTolerance).toEqual({
            enabled: true,
            minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
            disableOnWords: [],
            disableOnAttributes: [],
        });
        expect(settings.embedders).toBeUndefined();
    });

    it('derives limits from searchConfig and sorts facet values by count', () => {
        const settings = buildIndexSettings(
            mergeWithDefaults({ searchConfig: { totalItemsMaxSize: 500, facetValueMaxSize: 20, collectionMaxSize: 70 } }),
        );
        expect(settings.pagination).toEqual({ maxTotalHits: 500 });
        expect(settings.faceting).toEqual({ maxValuesPerFacet: 70, sortFacetValuesBy: { '*': 'count' } });
    });

    it('applies the plugin options', () => {
        const settings = buildIndexSettings(
            mergeWithDefaults({
                synonyms: { laptop: ['notebook'] },
                stopWords: ['the'],
                rankingRules: ['sort', 'words'],
                typoTolerance: { minWordSizeForOneTypo: 4, disableOnNumbers: true },
            }),
        );
        expect(settings.synonyms).toEqual({ laptop: ['notebook'], notebook: ['laptop'] });
        expect(settings.stopWords).toEqual(['the']);
        expect(settings.rankingRules).toEqual(['sort', 'words']);
        expect(settings.typoTolerance).toMatchObject({
            minWordSizeForTypos: { oneTypo: 4, twoTypos: 9 },
            disableOnNumbers: true,
        });
    });

    it('merges indexSettings, extending the attribute lists the plugin needs', () => {
        const settings = buildIndexSettings(
            mergeWithDefaults({
                indexSettings: {
                    searchCutoffMs: 300,
                    searchableAttributes: ['variant-brand'],
                    sortableAttributes: ['variant-rating'],
                    faceting: { maxValuesPerFacet: 500 },
                },
            }),
        );
        expect(settings.searchCutoffMs).toBe(300);
        expect(settings.searchableAttributes).toEqual(expect.arrayContaining(['productName', 'variant-brand']));
        expect(settings.sortableAttributes).toEqual(expect.arrayContaining(['price', 'variant-rating']));
        expect(settings.faceting).toEqual({ maxValuesPerFacet: 500, sortFacetValuesBy: { '*': 'count' } });
    });

    it('includes the configured embedders', () => {
        const settings = buildIndexSettings(
            mergeWithDefaults({
                ai: { embedders: { default: { source: 'openAi', model: 'text-embedding-3-small', apiKey: 'sk-x' } } },
            }),
        );
        expect(settings.embedders).toEqual({
            default: { source: 'openAi', model: 'text-embedding-3-small', apiKey: 'sk-x' },
        });
    });
});

describe('diffSettings()', () => {
    const desired = buildIndexSettings(mergeWithDefaults({ synonyms: { tv: ['television'] } }), '1.55.0');
    /** What Meilisearch returns once `settings` are applied (null ranking rules become the default). */
    const liveSettings = (settings: any): any => ({
        ...JSON.parse(JSON.stringify(settings)),
        rankingRules: ['words', 'typo', 'proximity', 'attributeRank', 'sort', 'wordPosition', 'exactness'],
    });

    it('is empty when the live settings match, including defaults Meilisearch adds', () => {
        const live = liveSettings(desired);
        live.typoTolerance.disableOnNumbers = false;
        live.faceting.sortFacetValuesBy = { '*': 'count' };
        live.filterableAttributes = [...(live.filterableAttributes as any[])].reverse();
        live.embedders = {};
        expect(diffSettings(desired, live)).toEqual({});
    });

    it('returns only the settings that changed', () => {
        const live = liveSettings(desired);
        live.synonyms = {};
        live.pagination = { maxTotalHits: 1000 };
        expect(Object.keys(diffSettings(desired, live)).sort()).toEqual(['pagination', 'synonyms']);
    });

    it('ignores masked embedder API keys', () => {
        const withEmbedder = buildIndexSettings(
            mergeWithDefaults({ ai: { embedders: { default: { source: 'openAi', apiKey: 'sk-secret' } } } }),
            '1.55.0',
        );
        const live = liveSettings(withEmbedder);
        live.embedders.default = { source: 'openAi', apiKey: 'sk-s...', dimensions: 1536 };
        expect(diffSettings(withEmbedder, live)).toEqual({});
    });

    it('accepts the default ranking rules of old and new engines', () => {
        const live = liveSettings(desired);
        live.rankingRules = ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'];
        expect(diffSettings(desired, live)).toEqual({});
        live.rankingRules = ['words', 'typo', 'proximity', 'attributeRank', 'sort', 'wordPosition', 'exactness'];
        expect(diffSettings(desired, live)).toEqual({});
        live.rankingRules = ['sort', 'words'];
        expect(diffSettings(desired, live)).toEqual({ rankingRules: null });
    });

    it('removes embedders that are no longer configured', () => {
        const live = liveSettings(desired);
        live.embedders = { old: { source: 'openAi' } };
        expect(diffSettings(desired, live)).toEqual({ embedders: { old: null } });
    });
});
