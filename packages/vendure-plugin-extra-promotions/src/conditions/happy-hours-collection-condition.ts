import { CollectionService, LanguageCode, PromotionCondition } from '@vendure/core';

import { getVariantIdsForCollections } from '../utils/collection-utils';

let collectionService: CollectionService;

/**
 * @description
 * Checks if the current time falls within the specified time range (Happy Hour)
 * **and** the order contains items belonging to any of the specified collections.
 *
 * Returns a state object containing the IDs of qualifying order lines,
 * so that the paired `happyHoursCollectionDiscountAction` can apply the
 * discount only to those specific lines.
 *
 * For example, set startHour=17, endHour=19 and pick a "Happy Hour Specials"
 * collection to run a 5pm-7pm discount on selected products only.
 * Supports overnight ranges (e.g. startHour=22, endHour=6 for 10pm-6am).
 */
export const happyHoursCollectionCondition = new PromotionCondition({
    code: 'happy_hours_collection',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Happy Hour ({ startHour }:00–{ endHour }:00) on products in selected collections',
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
        collectionIds: {
            type: 'ID',
            list: true,
            label: [{ languageCode: LanguageCode.en, value: 'Collection IDs' }],
            ui: { component: 'extra-promotions-collection-picker' },
        },
    },
    init(injector) {
        collectionService = injector.get(CollectionService);
    },
    async check(ctx, order, args) {
        // 1. Time gate — bail out early if outside the happy-hour window
        const currentHour = new Date().getHours();
        let withinTimeRange: boolean;
        if (args.startHour <= args.endHour) {
            // Same-day range: e.g. 17-19
            withinTimeRange = currentHour >= args.startHour && currentHour < args.endHour;
        } else {
            // Overnight range: e.g. 22-6 (10pm to 6am)
            withinTimeRange = currentHour >= args.startHour || currentHour < args.endHour;
        }
        if (!withinTimeRange) {
            return false;
        }

        // 2. Collection gate — find order lines whose variant is in the collections
        const allVariantIds = await getVariantIdsForCollections(
            collectionService,
            args.collectionIds,
            ctx,
        );

        const qualifyingLineIds: Record<string, boolean> = {};
        for (const line of order.lines) {
            if (allVariantIds.has(String(line.productVariant.id))) {
                qualifyingLineIds[String(line.id)] = true;
            }
        }

        if (Object.keys(qualifyingLineIds).length === 0) {
            return false;
        }

        return { qualifyingLineIds };
    },
});
