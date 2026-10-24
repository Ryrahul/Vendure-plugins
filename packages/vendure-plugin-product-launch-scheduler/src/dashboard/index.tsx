import { defineDashboardExtension } from '@vendure/dashboard';

import { launchSchedulesRoute } from './launch-schedules-page';
import { ProductSchedulesBlock } from './product-schedules-block';

defineDashboardExtension({
    routes: [launchSchedulesRoute],
    pageBlocks: [
        {
            id: 'product-launch-schedules',
            title: 'Launch schedule',
            location: {
                pageId: 'product-detail',
                column: 'side',
                position: { blockId: 'facet-values', order: 'after' },
            },
            requiresPermission: ['ReadCatalog', 'ReadProduct'],
            shouldRender: context => !!context.entity?.id,
            component: ({ context }) => (
                <ProductSchedulesBlock
                    productId={context.entity.id}
                    productName={context.entity.name}
                    globalEnabled={context.entity.enabled}
                />
            ),
        },
    ],
});
