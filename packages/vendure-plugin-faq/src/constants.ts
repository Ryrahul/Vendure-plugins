import { CrudPermissionDefinition } from '@vendure/core';

export const FAQ_PLUGIN_OPTIONS = Symbol('FAQ_PLUGIN_OPTIONS');
export const loggerCtx = 'FaqPlugin';

export const faqPermission = new CrudPermissionDefinition('Faq');
