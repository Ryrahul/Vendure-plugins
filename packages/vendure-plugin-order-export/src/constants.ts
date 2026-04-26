import { PermissionDefinition } from '@vendure/core';

export const PLUGIN_INIT_OPTIONS = Symbol('ORDER_EXPORT_PLUGIN_OPTIONS');
export const loggerCtx = 'OrderExportPlugin';

export const exportOrderPermission = new PermissionDefinition({
    name: 'ExportOrders',
    description: 'Allows exporting orders and viewing analytics',
});

export const manageReportSchedulePermission = new PermissionDefinition({
    name: 'ManageReportSchedules',
    description: 'Allows creating and managing scheduled reports',
});
