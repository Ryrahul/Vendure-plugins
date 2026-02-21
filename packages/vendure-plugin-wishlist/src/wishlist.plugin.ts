import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { shopApiExtensions } from './api/api-extensions';
import { ProductVariantEntityResolver } from './api/product-variant-entity.resolver';
import { WishlistShopResolver } from './api/wishlist.resolver';
import { WISHLIST_PLUGIN_OPTIONS } from './constants';
import { WishlistItem } from './entities/wishlist-item.entity';
import { WishlistService } from './services/wishlist.service';
import { WishlistPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [WishlistItem],
    providers: [
        { provide: WISHLIST_PLUGIN_OPTIONS, useFactory: () => WishlistPlugin.options },
        WishlistService,
    ],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [WishlistShopResolver, ProductVariantEntityResolver],
    },
    compatibility: '^3.0.0',
})
export class WishlistPlugin {
    static options: WishlistPluginOptions;

    static init(options?: WishlistPluginOptions): Type<WishlistPlugin> {
        this.options = options || {};
        return WishlistPlugin;
    }
}
