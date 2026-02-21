import { defineDashboardExtension } from '@vendure/dashboard';
import { MessageCircleQuestion } from 'lucide-react';

import { faqList } from './faq-list';
import { faqDetail } from './faq-detail';
import {
    DeleteFaqBulkAction,
    RemoveFaqsFromChannelBulkAction,
    AssignFaqsToChannelBulkAction,
} from './components/faq-bulk-actions';

defineDashboardExtension({
    navSections: [
        {
            id: 'help-and-support',
            title: 'Help & Support',
            icon: MessageCircleQuestion,
            order: 550,
        },
    ],
    routes: [faqList, faqDetail],
    dataTables: [
        {
            pageId: 'faq-list',
            bulkActions: [
                {
                    order: 100,
                    component: AssignFaqsToChannelBulkAction,
                },
                {
                    order: 200,
                    component: RemoveFaqsFromChannelBulkAction,
                },
                {
                    order: 300,
                    component: DeleteFaqBulkAction,
                },
            ],
        },
    ],
});
