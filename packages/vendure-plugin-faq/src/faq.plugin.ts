import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';
import { FaqAdminResolver } from './api/admin.resolver';
import { FaqShopResolver } from './api/shop.resolver';
import { faqPermission } from './constants';
import { Faq } from './entities/faq.entity';
import { FaqTranslation } from './entities/faq-translation.entity';
import { FaqService } from './services/faq.service';
import { FaqPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [Faq, FaqTranslation],
    adminApiExtensions: {
        resolvers: [FaqAdminResolver],
        schema: adminApiExtensions,
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [FaqShopResolver],
    },
    providers: [FaqService],
    configuration: (config) => {
        config.authOptions.customPermissions.push(faqPermission);
        return config;
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.0.0',
})
export class FaqPlugin {
    static options: FaqPluginOptions;

    static init(options?: FaqPluginOptions): Type<FaqPlugin> {
        this.options = options || {};
        return FaqPlugin;
    }
}
