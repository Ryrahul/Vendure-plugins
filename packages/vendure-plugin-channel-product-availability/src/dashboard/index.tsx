import { defineDashboardExtension } from '@vendure/dashboard';

import { ChannelAvailabilityBlock } from './channel-availability-block';

defineDashboardExtension({
    pageBlocks: [
        {
            id: 'channel-product-availability',
            title: 'Channel availability',
            location: {
                pageId: 'product-detail',
                column: 'side',
                // 'channels' only renders when more than one channel exists; 'facet-values' always does.
                position: { blockId: 'facet-values', order: 'after' },
            },
            requiresPermission: ['ReadCatalog', 'ReadProduct'],
            shouldRender: context => !!context.entity?.id,
            component: ({ context }) => <ChannelAvailabilityBlock productId={context.entity.id} />,
        },
    ],
});
