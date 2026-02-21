import { defineDashboardExtension } from '@vendure/dashboard';

import { CollectionPickerInput } from './components/collection-picker-input';

defineDashboardExtension({
    customFormComponents: {
        customFields: [
            {
                id: 'extra-promotions-collection-picker',
                component: CollectionPickerInput,
            },
        ],
    },
});
