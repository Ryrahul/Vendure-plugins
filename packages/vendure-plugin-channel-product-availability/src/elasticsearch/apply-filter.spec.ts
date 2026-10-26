import { describe, expect, it } from 'vitest';

import { applyChannelAvailabilityFilter, CHANNEL_ENABLED_FIELD, withChannelAvailability } from './index';

const shopQuery = () => ({
    bool: {
        must: [{ multi_match: { query: 'laptop' } }],
        filter: [{ term: { channelId: '1' } }, { term: { languageCode: 'en' } }, { term: { enabled: true } }],
    },
});

describe('applyChannelAvailabilityFilter()', () => {
    it('replaces the enabled term inside bool.filter, with the rollout fallback', () => {
        const query = applyChannelAvailabilityFilter(shopQuery(), true);
        expect(query.bool.filter).toHaveLength(3);
        expect(query.bool.filter[2]).toEqual({
            bool: {
                should: [
                    { term: { [CHANNEL_ENABLED_FIELD]: true } },
                    {
                        bool: {
                            must: [{ term: { enabled: true } }],
                            must_not: [{ exists: { field: CHANNEL_ENABLED_FIELD } }],
                        },
                    },
                ],
                minimum_should_match: 1,
            },
        });
        // relevance clauses untouched
        expect(query.bool.must).toEqual(shopQuery().bool.must);
        expect(query.bool.should).toBeUndefined();
    });

    it('leaves the query untouched when enabledOnly is false (Admin API)', () => {
        expect(applyChannelAvailabilityFilter(shopQuery(), false)).toEqual(shopQuery());
    });

    it('leaves the query untouched without bool.filter or without an enabled term', () => {
        expect(applyChannelAvailabilityFilter({ match_all: {} }, true)).toEqual({ match_all: {} });
        const noEnabled = { bool: { filter: [{ term: { channelId: '1' } }] } };
        expect(applyChannelAvailabilityFilter(noEnabled, true)).toEqual({ bool: { filter: [{ term: { channelId: '1' } }] } });
        expect(applyChannelAvailabilityFilter(undefined, true)).toBeUndefined();
    });

    it('is idempotent', () => {
        const once = applyChannelAvailabilityFilter(shopQuery(), true);
        const twice = applyChannelAvailabilityFilter(JSON.parse(JSON.stringify(once)), true);
        expect(twice).toEqual(once);
    });
});

describe('withChannelAvailability()', () => {
    it('adds the mapping and index mapping, keeping existing ones', () => {
        const options = withChannelAvailability({
            customProductVariantMappings: { color: { graphQlType: 'String', valueFn: () => 'red' } },
            indexMappingProperties: { 'variant-color': { type: 'keyword' } },
        } as any);
        expect(Object.keys(options.customProductVariantMappings!)).toEqual(['color', 'channelEnabled']);
        expect(options.indexMappingProperties).toEqual({
            'variant-color': { type: 'keyword' },
            [CHANNEL_ENABLED_FIELD]: { type: 'boolean' },
        });
    });

    it('applies the filter before an existing mapQuery, which sees bool.filter intact', () => {
        const seen: any[] = [];
        const options = withChannelAvailability({
            searchConfig: {
                mapQuery: (query: any, _input: any, _config: any, _channelId: any, enabledOnly: boolean) => {
                    seen.push(JSON.parse(JSON.stringify(query)));
                    // an early return, as in MyMart's mapQuery when there is no term
                    if (!enabledOnly) return query;
                    query.bool.should = [{ match: { productName: 'boost' } }];
                    return query;
                },
            },
        } as any);
        const result = options.searchConfig!.mapQuery!(shopQuery(), {} as any, {} as any, '1', true, {} as any);
        expect(seen[0].bool.filter[2].bool.should[0]).toEqual({ term: { [CHANNEL_ENABLED_FIELD]: true } });
        expect(result.bool.should).toEqual([{ match: { productName: 'boost' } }]);
    });

    it('works without an existing mapQuery', () => {
        const options = withChannelAvailability({} as any);
        const result = options.searchConfig!.mapQuery!(shopQuery(), {} as any, {} as any, '1', true, {} as any);
        expect(result.bool.filter[2].bool).toBeDefined();
    });
});
