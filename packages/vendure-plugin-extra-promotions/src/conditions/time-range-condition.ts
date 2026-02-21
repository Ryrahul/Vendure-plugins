import { LanguageCode, PromotionCondition } from '@vendure/core';

/**
 * @description
 * Checks if the current time falls within the specified time range (Happy Hour).
 * Times are evaluated in the server's local timezone.
 *
 * For example, set startHour=17 and endHour=19 to run a promotion from 5pm to 7pm.
 * Supports overnight ranges (e.g. startHour=22, endHour=6 for 10pm-6am).
 */
export const timeRangeCondition = new PromotionCondition({
    code: 'time_range',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Current time is between { startHour }:00 and { endHour }:00 (Happy Hour)',
        },
    ],
    args: {
        startHour: {
            type: 'int',
            defaultValue: 17,
            label: [{ languageCode: LanguageCode.en, value: 'Start hour (0-23)' }],
            ui: { component: 'number-form-input', min: 0, max: 23 },
        },
        endHour: {
            type: 'int',
            defaultValue: 19,
            label: [{ languageCode: LanguageCode.en, value: 'End hour (0-23)' }],
            ui: { component: 'number-form-input', min: 0, max: 23 },
        },
    },
    check(ctx, order, args) {
        const currentHour = new Date().getHours();
        if (args.startHour <= args.endHour) {
            // Same-day range: e.g. 17-19
            return currentHour >= args.startHour && currentHour < args.endHour;
        } else {
            // Overnight range: e.g. 22-6 (10pm to 6am)
            return currentHour >= args.startHour || currentHour < args.endHour;
        }
    },
});
