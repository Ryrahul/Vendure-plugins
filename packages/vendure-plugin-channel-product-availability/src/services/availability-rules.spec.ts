import { describe, expect, it } from 'vitest';

import {
    buildEffectiveEnabledProductFilter,
    enforceGuardFilter,
    resolveEffectiveEnabled,
    toOverrideState,
} from './availability-rules';

describe('resolveEffectiveEnabled', () => {
    it.each([
        [true, undefined, true],
        [false, undefined, false],
        [true, null, true],
        [false, null, false],
        [true, true, true],
        [true, false, false],
        [false, true, true],
        [false, false, false],
    ])('global=%s override=%s → %s', (global, override, expected) => {
        expect(resolveEffectiveEnabled(global, override)).toBe(expected);
    });
});

describe('toOverrideState', () => {
    it('distinguishes inherited, enabled and disabled', () => {
        expect(toOverrideState(undefined)).toBe('INHERITED');
        expect(toOverrideState(null)).toBe('INHERITED');
        expect(toOverrideState(true)).toBe('ENABLED');
        expect(toOverrideState(false)).toBe('DISABLED');
    });
});

describe('buildEffectiveEnabledProductFilter', () => {
    it('is the plain global guard when there are no overrides', () => {
        expect(buildEffectiveEnabledProductFilter([], [])).toEqual({ enabled: { eq: true } });
    });

    it('excludes explicitly disabled products', () => {
        expect(buildEffectiveEnabledProductFilter([], ['2'])).toEqual({
            _and: [{ enabled: { eq: true } }, { id: { notIn: ['2'] } }],
        });
    });

    it('includes explicitly enabled products', () => {
        expect(buildEffectiveEnabledProductFilter(['1'], [])).toEqual({
            _or: [{ enabled: { eq: true } }, { id: { in: ['1'] } }],
        });
    });

    it('combines both without emitting empty IN lists', () => {
        expect(buildEffectiveEnabledProductFilter(['1'], ['2'])).toEqual({
            _or: [{ _and: [{ enabled: { eq: true } }, { id: { notIn: ['2'] } }] }, { id: { in: ['1'] } }],
        });
    });
});

describe('enforceGuardFilter', () => {
    const guard = { enabled: { eq: true } };

    it('uses the guard alone when there is no user filter', () => {
        expect(enforceGuardFilter({ take: 5 }, guard)).toEqual({ take: 5, filter: guard, filterOperator: undefined });
        expect(enforceGuardFilter(undefined, guard)).toEqual({ filter: guard, filterOperator: undefined });
    });

    it('ANDs the guard with an AND user filter', () => {
        const result = enforceGuardFilter({ filter: { name: { contains: 'a' } } }, guard);
        expect(result.filter).toEqual({ _and: [{ _and: [{ name: { contains: 'a' } }] }, guard] });
    });

    it('cannot be bypassed with filterOperator OR', () => {
        const result = enforceGuardFilter(
            { filter: { name: { contains: 'a' }, enabled: { eq: false } }, filterOperator: 'OR' },
            guard,
        );
        expect(result.filterOperator).toBeUndefined();
        expect(result.filter).toEqual({
            _and: [{ _or: [{ name: { contains: 'a' }, enabled: { eq: false } }] }, guard],
        });
    });
});
