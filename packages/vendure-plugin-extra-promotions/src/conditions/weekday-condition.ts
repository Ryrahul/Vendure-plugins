import { LanguageCode, PromotionCondition } from '@vendure/core';

/**
 * Day-of-week mapping for the UI select options.
 * JavaScript Date.getDay(): 0 = Sunday, 1 = Monday, ... 6 = Saturday
 */
const dayOptions = [
    { value: '0', label: [{ languageCode: LanguageCode.en, value: 'Sunday' }] },
    { value: '1', label: [{ languageCode: LanguageCode.en, value: 'Monday' }] },
    { value: '2', label: [{ languageCode: LanguageCode.en, value: 'Tuesday' }] },
    { value: '3', label: [{ languageCode: LanguageCode.en, value: 'Wednesday' }] },
    { value: '4', label: [{ languageCode: LanguageCode.en, value: 'Thursday' }] },
    { value: '5', label: [{ languageCode: LanguageCode.en, value: 'Friday' }] },
    { value: '6', label: [{ languageCode: LanguageCode.en, value: 'Saturday' }] },
];

/**
 * @description
 * Checks if the current day of the week matches one of the specified days.
 * Useful for "Weekend Sale" or "Friday Flash Sale" promotions.
 */
export const weekdayCondition = new PromotionCondition({
    code: 'weekday',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Current day is one of the selected days of the week',
        },
    ],
    args: {
        days: {
            type: 'string',
            list: true,
            label: [{ languageCode: LanguageCode.en, value: 'Days of the week' }],
            ui: {
                component: 'select-form-input',
                options: dayOptions,
            },
        },
    },
    check(ctx, order, args) {
        const currentDay = String(new Date().getDay());
        return args.days.includes(currentDay);
    },
});
