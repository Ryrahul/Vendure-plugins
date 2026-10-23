import { LanguageCode } from '@vendure/common/lib/generated-types';
import { InitialData } from '@vendure/core';

export const initialData: InitialData = {
    defaultLanguage: LanguageCode.en,
    defaultZone: 'Europe',
    taxRates: [{ name: 'Standard Tax', percentage: 20 }],
    shippingMethods: [],
    paymentMethods: [],
    countries: [{ name: 'United Kingdom', code: 'GB', zone: 'Europe' }],
    collections: [
        {
            name: 'Electronics',
            filters: [{ code: 'facet-value-filter', args: { facetValueNames: ['electronics'], containsAny: false } }],
        },
    ],
};
