import { InitialData, LanguageCode } from '@vendure/core';

export const initialData: InitialData = {
    defaultLanguage: LanguageCode.en,
    defaultZone: 'Europe',
    taxRates: [{ name: 'Standard Tax', percentage: 20 }],
    shippingMethods: [{ name: 'Standard Shipping', price: 500 }],
    paymentMethods: [{ name: 'Test Payment', handler: { code: 'test-payment', arguments: [] } }],
    countries: [{ name: 'United Kingdom', code: 'GB', zone: 'Europe' }],
    collections: [
        {
            name: 'Electronics',
            filters: [
                {
                    code: 'facet-value-filter',
                    args: { facetValueNames: ['electronics'], containsAny: false },
                },
            ],
        },
    ],
};
