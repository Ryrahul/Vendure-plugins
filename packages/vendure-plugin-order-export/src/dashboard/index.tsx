import { defineDashboardExtension } from '@vendure/dashboard';
import { BarChart3 } from 'lucide-react';

import { analyticsDashboard } from './analytics-dashboard';
import { exportList } from './export-list';
import { scheduleList } from './schedule-list';

defineDashboardExtension({
    navSections: [
        {
            id: 'order-analytics',
            title: 'Order Analytics',
            icon: BarChart3,
            order: 500,
        },
    ],
    routes: [analyticsDashboard, exportList, scheduleList],
});
