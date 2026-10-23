import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { unique } from '@vendure/common/lib/unique';
import {
    asyncObservable,
    AsyncQueue,
    Collection,
    ConfigService,
    EntityRelationPaths,
    FacetValue,
    ID,
    Injector,
    InternalServerError,
    LanguageCode,
    Logger,
    MutableRequestContext,
    Product,
    ProductPriceApplicator,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    RequestContextCacheService,
    TransactionalConnection,
    Translatable,
    Translation,
} from '@vendure/core';
import { Index, IndexSwap, Meilisearch } from 'meilisearch';
import { Observable } from 'rxjs';
import { In, IsNull } from 'typeorm';

import { MEILISEARCH_OPTIONS, loggerCtx, VARIANT_INDEX_NAME } from '../constants';
import { MeilisearchRuntimeOptions } from '../options';
import {
    ProductChannelMessageData,
    ProductIndexItem,
    ReindexMessageData,
    UpdateAssetMessageData,
    UpdateProductMessageData,
    UpdateVariantMessageData,
    UpdateVariantsByIdMessageData,
    VariantChannelMessageData,
    VariantIndexItem,
} from '../types';

import { escapeFilterValue } from '../build-search-query';

import { configureIndex, createIndex, getClient, getIndexUid, waitForTask, waitForTasks } from './indexing-utils';

/** Document batches a reindex may have enqueued in Meilisearch before it waits for the oldest. */
const MAX_PENDING_BATCHES = 10;

export const defaultProductRelations: Array<EntityRelationPaths<Product>> = [
    'featuredAsset',
    'facetValues',
    'facetValues.facet',
    'channels',
    'channels.defaultTaxZone',
];

export const defaultVariantRelations: Array<EntityRelationPaths<ProductVariant>> = [
    'featuredAsset',
    'facetValues',
    'facetValues.facet',
    'collections',
    'taxCategory',
    'channels',
    'channels.defaultTaxZone',
];

export interface ReindexMessageResponse {
    total: number;
    completed: number;
    duration: number;
}

@Injectable()
export class MeilisearchIndexerController implements OnModuleInit, OnModuleDestroy {
    private client: Meilisearch;
    private asyncQueue = new AsyncQueue('meilisearch-indexer', 5);
    private productRelations: Array<EntityRelationPaths<Product>>;
    private variantRelations: Array<EntityRelationPaths<ProductVariant>>;
    private injector: Injector;

    constructor(
        private connection: TransactionalConnection,
        @Inject(MEILISEARCH_OPTIONS) private options: MeilisearchRuntimeOptions,
        private productPriceApplicator: ProductPriceApplicator,
        private configService: ConfigService,
        private productVariantService: ProductVariantService,
        private requestContextCache: RequestContextCacheService,
        private moduleRef: ModuleRef,
    ) {}

    onModuleInit(): any {
        // The Meilisearch JS client is stateless — it wraps fetch with config
        // and does not maintain connection pools or persistent connections.
        // A separate instance in MeilisearchService is intentional:
        // each service owns its own client for clarity and lifecycle isolation.
        this.client = getClient(this.options);
        this.productRelations = this.getReindexRelations(
            defaultProductRelations,
            this.options.hydrateProductRelations,
        );
        this.variantRelations = this.getReindexRelations(
            defaultVariantRelations,
            this.options.hydrateProductVariantRelations,
        );
        this.injector = new Injector(this.moduleRef);
    }

    onModuleDestroy(): any {
        // Meilisearch JS client has no close method
    }

    /**
     * Updates the search index only for the affected product.
     */
    async updateProduct({ ctx: rawContext, productId }: UpdateProductMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(rawContext);
        await this.updateProductsInternal(ctx, [productId]);
        return true;
    }

    /**
     * Deletes the product from the search index.
     */
    async deleteProduct({ ctx: rawContext, productId }: UpdateProductMessageData): Promise<boolean> {
        await this.deleteProductOperations(RequestContext.deserialize(rawContext), productId);
        return true;
    }

    /**
     * Updates the search index when a product is assigned to a channel.
     * The `channelId` parameter is intentionally unused — by the time this handler
     * runs, the ProductChannelEvent has already mutated the DB, and
     * `updateProductsInternal` re-reads the current channel bindings.
     */
    async assignProductToChannel({
        ctx: rawContext,
        productId,
        channelId: _channelId,
    }: ProductChannelMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(rawContext);
        await this.updateProductsInternal(ctx, [productId]);
        return true;
    }

    /**
     * Updates the search index when a product is removed from a channel.
     * See `assignProductToChannel` for why `channelId` is unused.
     */
    async removeProductFromChannel({
        ctx: rawContext,
        productId,
        channelId: _channelId,
    }: ProductChannelMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(rawContext);
        await this.updateProductsInternal(ctx, [productId]);
        return true;
    }

    async assignVariantToChannel({
        ctx: rawContext,
        productVariantId,
        channelId,
    }: VariantChannelMessageData): Promise<boolean> {
        const productIds = await this.getProductIdsByVariantIds([productVariantId]);
        const ctx = MutableRequestContext.deserialize(rawContext);
        await this.updateProductsInternal(ctx, productIds);
        return true;
    }

    async removeVariantFromChannel({
        ctx: rawContext,
        productVariantId,
        channelId,
    }: VariantChannelMessageData): Promise<boolean> {
        const productIds = await this.getProductIdsByVariantIds([productVariantId]);
        const ctx = MutableRequestContext.deserialize(rawContext);
        await this.updateProductsInternal(ctx, productIds);
        return true;
    }

    /**
     * Updates the search index only for the affected entities.
     */
    async updateVariants({ ctx: rawContext, variantIds }: UpdateVariantMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(rawContext);
        return this.asyncQueue.push(async () => {
            const productIds = await this.getProductIdsByVariantIds(variantIds);
            await this.updateProductsInternal(ctx, productIds);
            return true;
        });
    }

    async deleteVariants({ ctx: rawContext, variantIds }: UpdateVariantMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(rawContext);
        return this.asyncQueue.push(async () => {
            const productIds = await this.getProductIdsByVariantIds(variantIds);
            await this.updateProductsInternal(ctx, productIds);
            return true;
        });
    }

    updateVariantsById({
        ctx: rawContext,
        ids,
    }: UpdateVariantsByIdMessageData): Observable<ReindexMessageResponse> {
        const ctx = MutableRequestContext.deserialize(rawContext);
        return asyncObservable(async observer => {
            return this.asyncQueue.push(async () => {
                const timeStart = Date.now();
                const productIds = await this.getProductIdsByVariantIds(ids);
                if (productIds.length) {
                    await this.updateProductsInternal(ctx, productIds, completed =>
                        observer.next({
                            total: productIds.length,
                            completed,
                            duration: +new Date() - timeStart,
                        }),
                    );
                }
                Logger.verbose('Completed updating variants', loggerCtx);
                return {
                    total: productIds.length,
                    completed: productIds.length,
                    duration: +new Date() - timeStart,
                };
            });
        });
    }

    /**
     * Rebuilds the whole index into a fresh temporary index, then atomically swaps it
     * into place. The three phases — create, populate, promote — are separate methods
     * below; each cleans up the temporary index if it fails, so a failed reindex never
     * leaves the live index stale-but-reported-healthy, nor leaves scratch indexes behind.
     */
    reindex({ ctx: rawContext }: ReindexMessageData): Observable<ReindexMessageResponse> {
        return asyncObservable(async observer => {
            return this.asyncQueue.push(async () => {
                const timeStart = Date.now();
                const ctx = MutableRequestContext.deserialize(rawContext);

                const primaryIndexUid = getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME);
                const tempIndexUid = getIndexUid(
                    this.options.indexPrefix,
                    `${VARIANT_INDEX_NAME}-reindex-${new Date().getTime()}`,
                );

                await this.createTempIndex(tempIndexUid);
                const totalProductIds = await this.populateTempIndex(
                    ctx,
                    tempIndexUid,
                    timeStart,
                    progress => observer.next(progress),
                );
                await this.swapAndPromote(tempIndexUid, primaryIndexUid);

                Logger.verbose('Completed reindexing!', loggerCtx);

                return {
                    total: totalProductIds,
                    completed: totalProductIds,
                    duration: +new Date() - timeStart,
                };
            });
        });
    }

    /**
     * Reindex phase 1 — create and configure the temporary index the reindex writes into.
     */
    private async createTempIndex(tempIndexUid: string): Promise<void> {
        try {
            await createIndex(this.client, tempIndexUid, 'id', this.options);
            await configureIndex(this.client, tempIndexUid, this.options);
        } catch (e: any) {
            Logger.error('Could not create temporary reindex index.', loggerCtx);
            Logger.error(e.message, loggerCtx, e.stack);
            await this.deleteIndexQuietly(tempIndexUid);
            throw e;
        }
    }

    /**
     * Reindex phase 2 — write every non-deleted product into the temporary index,
     * reporting progress as it goes. Returns the total number of products processed.
     *
     * Documents of many products are sent together in batches of `reindexBatchSize`, and the
     * batches are enqueued without waiting for each one: Meilisearch processes consecutive
     * document tasks together, which is much faster than one task per product. At most
     * `MAX_PENDING_BATCHES` are in flight; all of them must succeed before the swap.
     */
    private async populateTempIndex(
        ctx: MutableRequestContext,
        tempIndexUid: string,
        timeStart: number,
        onProgress: (progress: ReindexMessageResponse) => void,
    ): Promise<number> {
        const index = this.client.index(tempIndexUid);
        const totalProductIds = await this.connection.rawConnection
            .getRepository(Product)
            .createQueryBuilder('product')
            .where('product.deletedAt IS NULL')
            .getCount();

        Logger.verbose(`Will reindex ${totalProductIds} products`, loggerCtx);

        let productIds: Product[] = [];
        let skip = 0;
        let finishedProductsCount = 0;
        let documents: VariantIndexItem[] = [];
        const pendingTasks: number[] = [];
        const flush = async () => {
            if (!documents.length) {
                return;
            }
            const task = await index.addDocuments(documents as any[]);
            Logger.debug(`Enqueued ${documents.length} documents for [${index.uid}]`, loggerCtx);
            documents = [];
            pendingTasks.push(task.taskUid);
            while (pendingTasks.length > MAX_PENDING_BATCHES) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                await waitForTask(this.client, pendingTasks.shift()!, this.options);
            }
        };
        try {
            do {
                productIds = await this.connection.rawConnection
                    .getRepository(Product)
                    .createQueryBuilder('product')
                    .select('product.id')
                    .where('product.deletedAt IS NULL')
                    .orderBy('product.id', 'ASC')
                    .skip(skip)
                    .take(this.options.reindexProductsChunkSize)
                    .getMany();

                for (const { id: productId } of productIds) {
                    documents.push(...(await this.buildProductDocuments(ctx, productId)));
                    if (documents.length >= this.options.reindexBatchSize) {
                        await flush();
                    }
                    finishedProductsCount++;
                    onProgress({
                        total: totalProductIds,
                        completed: Math.min(finishedProductsCount, totalProductIds),
                        duration: +new Date() - timeStart,
                    });
                }

                skip += this.options.reindexProductsChunkSize;

                Logger.verbose(`Done ${finishedProductsCount} / ${totalProductIds} products`);
            } while (productIds.length >= this.options.reindexProductsChunkSize);
            await flush();
            await waitForTasks(this.client, pendingTasks, this.options);
        } catch (e: any) {
            // The temp index is a scratch copy that nothing reads from, so a failed
            // populate must not leave it behind to accumulate on the Meilisearch
            // instance. The live index is untouched — the swap never happened.
            Logger.error(
                `Reindex failed while populating "${tempIndexUid}": ${e.message as string}`,
                loggerCtx,
                e.stack,
            );
            await this.deleteIndexQuietly(tempIndexUid);
            throw e;
        }

        return totalProductIds;
    }

    /**
     * Reindex phase 3 — atomically swap the freshly populated temporary index with the
     * live index, then drop the old one (which sits at the temp UID after the swap).
     *
     * Meilisearch's swapIndexes exchanges documents, settings (filterable, searchable
     * and sortable attributes, synonyms, typo tolerance, embedders) and task history
     * between the two indexes in a single atomic operation.
     * See: https://www.meilisearch.com/docs/reference/api/swap_indexes
     */
    private async swapAndPromote(tempIndexUid: string, primaryIndexUid: string): Promise<void> {
        try {
            // Ensure the primary index exists before swapping
            await createIndex(this.client, primaryIndexUid, 'id', this.options);

            // `rename` is only understood by Meilisearch v1.31+, and the SDK types
            // mark it required. We deliberately omit it so the server applies its
            // default (a plain swap) — passing it would break older servers, and
            // passing `rename: false` was observed to prevent index settings
            // (including embedders) from being carried over.
            const swapTask = await this.client.swapIndexes([
                { indexes: [tempIndexUid, primaryIndexUid] } as IndexSwap,
            ]);
            await waitForTask(this.client, swapTask.taskUid, this.options);

            const deleteTask = await this.client.deleteIndex(tempIndexUid);
            await waitForTask(this.client, deleteTask.taskUid, this.options);
        } catch (e: any) {
            Logger.error('Could not swap indexes.', loggerCtx);
            Logger.error(e.message, loggerCtx, e.stack);
            await this.deleteIndexQuietly(tempIndexUid);
            throw e;
        }
    }

    async updateAsset(data: UpdateAssetMessageData): Promise<boolean> {
        const index = this.client.index(getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME));
        const assetId = escapeFilterValue(data.asset.id);
        const focalPoint = data.asset.focalPoint || null;

        await this.updateDocumentsMatching(index, `productAssetId = "${assetId}"`, {
            productPreviewFocalPoint: focalPoint,
        });
        await this.updateDocumentsMatching(index, `productVariantAssetId = "${assetId}"`, {
            productVariantPreviewFocalPoint: focalPoint,
        });
        return true;
    }

    async deleteAsset(data: UpdateAssetMessageData): Promise<boolean> {
        const index = this.client.index(getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME));
        const assetId = escapeFilterValue(data.asset.id);

        await this.updateDocumentsMatching(index, `productAssetId = "${assetId}"`, {
            productAssetId: null,
            productPreview: '',
            productPreviewFocalPoint: null,
        });
        await this.updateDocumentsMatching(index, `productVariantAssetId = "${assetId}"`, {
            productVariantAssetId: null,
            productVariantPreview: '',
            productVariantPreviewFocalPoint: null,
        });
        return true;
    }

    /**
     * Applies a partial update to every document matching the filter. Only the given fields
     * are sent (`updateDocuments` merges them into the stored documents).
     */
    private async updateDocumentsMatching(
        index: Index,
        filter: string,
        fields: Record<string, unknown>,
    ): Promise<void> {
        const ids = await this.getDocumentIds(index, filter);
        for (let i = 0; i < ids.length; i += this.options.reindexBatchSize) {
            const chunk = ids.slice(i, i + this.options.reindexBatchSize);
            const task = await index.updateDocuments(chunk.map(id => ({ id, ...fields })));
            await waitForTask(this.client, task.taskUid, this.options);
        }
    }

    /**
     * The ids of all documents matching the filter. Uses the documents endpoint rather than
     * search, which is capped at `pagination.maxTotalHits`.
     */
    private async getDocumentIds(index: Index, filter: string): Promise<string[]> {
        const ids: string[] = [];
        const limit = 1000;
        for (let offset = 0; ; offset += limit) {
            const { results } = await index.getDocuments<{ id: string }>({ filter, fields: ['id'], offset, limit });
            ids.push(...results.map(doc => doc.id));
            if (results.length < limit) {
                return ids;
            }
        }
    }

    /**
     * Re-indexes products in the live index.
     *
     * The new documents are written first and documents that no longer exist (a removed variant,
     * channel or translation) are deleted afterwards, so a product never disappears from search
     * while it is being updated. Meilisearch processes an index's tasks in the order they were
     * enqueued, so each delete is applied after the additions sent before it.
     *
     * Documents of many products are sent together in batches of `reindexBatchSize` without
     * waiting for each product: a collection change can re-index thousands of products, and one
     * Meilisearch task per product (each calling the embedding provider) would take hours. All
     * tasks are checked at the end, so a failure still fails the job.
     */
    private async updateProductsInternal(
        ctx: MutableRequestContext,
        productIds: ID[],
        onProductDone?: (completed: number) => void,
    ) {
        Logger.debug(`Updating ${productIds.length} Products`, loggerCtx);
        const index = this.client.index(getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME));
        const pendingTasks: number[] = [];
        let documents: VariantIndexItem[] = [];
        let staleIds: string[] = [];
        const flush = async () => {
            if (documents.length) {
                pendingTasks.push((await index.addDocuments(documents as any[])).taskUid);
                Logger.debug(`Enqueued ${documents.length} documents for [${index.uid}]`, loggerCtx);
            }
            if (staleIds.length) {
                pendingTasks.push((await index.deleteDocuments(staleIds)).taskUid);
                Logger.debug(`Enqueued deletion of ${staleIds.length} stale documents from [${index.uid}]`, loggerCtx);
            }
            documents = [];
            staleIds = [];
            while (pendingTasks.length > MAX_PENDING_BATCHES) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                await waitForTask(this.client, pendingTasks.shift()!, this.options);
            }
        };

        let completed = 0;
        for (const productId of productIds) {
            const productDocuments = await this.buildProductDocuments(ctx, productId);
            const existingIds = await this.getDocumentIds(index, this.productFilter(productId));
            const currentIds = new Set(productDocuments.map(doc => doc.id));
            documents.push(...productDocuments);
            staleIds.push(...existingIds.filter(id => !currentIds.has(id)));
            if (documents.length >= this.options.reindexBatchSize) {
                await flush();
            }
            onProductDone?.(++completed);
        }
        await flush();
        await waitForTasks(this.client, pendingTasks, this.options);
    }

    /**
     * Builds the search documents of a product: one per variant, channel and language (or one
     * synthetic document per channel and language for a product without variants). Returns an
     * empty list for a deleted or missing product.
     */
    private async buildProductDocuments(ctx: MutableRequestContext, productId: ID): Promise<VariantIndexItem[]> {
        let product: Product | undefined;
        try {
            product = await this.connection
                .getRepository(ctx, Product)
                .find({
                    where: { id: productId, deletedAt: IsNull() },
                    relations: this.productRelations,
                })
                .then(result => result[0] ?? undefined);
        } catch (e: any) {
            Logger.error(e.message, loggerCtx, e.stack);
            throw e;
        }
        if (!product) {
            return [];
        }

        let updatedProductVariants: ProductVariant[] = [];
        try {
            updatedProductVariants = await this.connection.rawConnection.getRepository(ProductVariant).find({
                relations: this.variantRelations,
                where: {
                    productId,
                    deletedAt: IsNull(),
                },
                order: {
                    id: 'ASC',
                },
            });
        } catch (e: any) {
            Logger.error(e.message, loggerCtx, e.stack);
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        updatedProductVariants.forEach(variant => (variant.product = product!));
        if (!product.enabled) {
            updatedProductVariants.forEach(v => (v.enabled = false));
        }

        Logger.debug(`Updating Product (${productId})`, loggerCtx);
        const languageVariants: LanguageCode[] = [];
        languageVariants.push(...product.translations.map(t => t.languageCode));
        for (const variant of updatedProductVariants) {
            languageVariants.push(...variant.translations.map(t => t.languageCode));
        }

        const uniqueLanguageVariants = unique(languageVariants);
        const originalChannel = ctx.channel;
        const documents: VariantIndexItem[] = [];

        for (const channel of product.channels) {
            ctx.setChannel(channel);
            const variantsInChannel = updatedProductVariants.filter(v =>
                v.channels.map(c => c.id).includes(ctx.channelId),
            );
            for (const variant of variantsInChannel) {
                await this.productPriceApplicator.applyChannelPriceAndTax(variant, ctx);
            }

            for (const languageCode of uniqueLanguageVariants) {
                if (variantsInChannel.length) {
                    for (const variant of variantsInChannel) {
                        documents.push(
                            await this.createVariantIndexItem(variant, variantsInChannel, ctx, languageCode),
                        );
                    }
                } else {
                    documents.push(await this.createSyntheticProductIndexItem(product, ctx, languageCode));
                }
            }
        }
        ctx.setChannel(originalChannel);
        return documents;
    }

    private async deleteProductOperations(_ctx: RequestContext, productId: ID): Promise<void> {
        const index = this.client.index(getIndexUid(this.options.indexPrefix, VARIANT_INDEX_NAME));
        Logger.debug(`Deleting 1 Product (id: ${productId})`, loggerCtx);
        try {
            const task = await index.deleteDocuments({ filter: this.productFilter(productId) });
            await waitForTask(this.client, task.taskUid, this.options);
        } catch (e: any) {
            Logger.error(`Error deleting documents: ${e.message as string}`, loggerCtx, e.stack);
            throw e;
        }
    }

    private productFilter(productId: ID): string {
        return `productId = "${escapeFilterValue(productId)}"`;
    }

    /**
     * Takes the default relations, and combines them with any extra relations specified in the
     * `hydrateProductRelations` and `hydrateProductVariantRelations`. This method also ensures
     * that the relation values are unique and that paths are fully expanded.
     */
    private getReindexRelations<T extends Product | ProductVariant>(
        defaultRelations: Array<EntityRelationPaths<T>>,
        hydratedRelations: Array<EntityRelationPaths<T>>,
    ): Array<EntityRelationPaths<T>> {
        const uniqueRelations = unique([...defaultRelations, ...hydratedRelations]);
        for (const relation of hydratedRelations) {
            let path = relation.split('.');
            if (path[0] === 'customFields') {
                if (path.length > 2) {
                    throw new InternalServerError(
                        [
                            'hydrateProductRelations / hydrateProductVariantRelations does not currently support nested custom field relations',
                            `Received: "${relation}"`,
                        ].join('\n'),
                    );
                }
                path = [path.join('.')];
            }
            const pathToPart: string[] = [];
            for (const part of path) {
                pathToPart.push(part);
                const joinedPath = pathToPart.join('.') as EntityRelationPaths<T>;
                if (!uniqueRelations.includes(joinedPath)) {
                    uniqueRelations.push(joinedPath);
                }
            }
        }
        return uniqueRelations;
    }

    private async getProductIdsByVariantIds(variantIds: ID[]): Promise<ID[]> {
        const variants = await this.connection.getRepository(ProductVariant).find({
            where: { id: In(variantIds) },
            relations: ['product'],
            loadEagerRelations: false,
        });
        return unique(variants.map(v => v.product.id));
    }

    private async createVariantIndexItem(
        v: ProductVariant,
        variants: ProductVariant[],
        ctx: RequestContext,
        languageCode: LanguageCode,
    ): Promise<VariantIndexItem> {
        try {
            const productAsset = v.product.featuredAsset;
            const variantAsset = v.featuredAsset;
            const productTranslation = this.getTranslation(v.product, languageCode);
            const variantTranslation = this.getTranslation(v, languageCode);
            const collectionTranslations = v.collections.map(c => this.getTranslation(c, languageCode));

            const productCollectionTranslations = variants.reduce(
                (translations, variant) => [
                    ...translations,
                    ...variant.collections.map(c => this.getTranslation(c, languageCode)),
                ],
                [] as Array<Translation<Collection>>,
            );
            const prices = variants.map(variant => variant.price);
            const pricesWithTax = variants.map(variant => variant.priceWithTax);

            const item: VariantIndexItem = {
                id: MeilisearchIndexerController.getId(v.id, ctx.channelId, languageCode),
                channelId: ctx.channelId,
                languageCode,
                productVariantId: v.id,
                sku: v.sku,
                slug: productTranslation.slug,
                productId: v.product.id,
                productName: productTranslation.name,
                productAssetId: productAsset ? productAsset.id : undefined,
                productPreview: productAsset ? productAsset.preview : '',
                productPreviewFocalPoint: productAsset ? productAsset.focalPoint || undefined : undefined,
                productVariantName: variantTranslation.name,
                productVariantAssetId: variantAsset ? variantAsset.id : undefined,
                productVariantPreview: variantAsset ? variantAsset.preview : '',
                productVariantPreviewFocalPoint: variantAsset
                    ? variantAsset.focalPoint || undefined
                    : undefined,
                price: v.price,
                priceWithTax: v.priceWithTax,
                currencyCode: v.currencyCode,
                description: productTranslation.description,
                facetIds: this.getFacetIds([v]),
                channelIds: v.channels.map(c => c.id),
                facetValueIds: this.getFacetValueIds([v]),
                collectionIds: v.collections.map(c => c.id.toString()),
                collectionSlugs: collectionTranslations.map(c => c.slug),
                enabled: v.enabled && v.product.enabled,
                productEnabled: variants.some(variant => variant.enabled) && v.product.enabled,
                productPriceMin: prices.reduce((a, b) => Math.min(a, b), Infinity),
                productPriceMax: prices.reduce((a, b) => Math.max(a, b), -Infinity),
                productPriceWithTaxMin: pricesWithTax.reduce((a, b) => Math.min(a, b), Infinity),
                productPriceWithTaxMax: pricesWithTax.reduce((a, b) => Math.max(a, b), -Infinity),
                productFacetIds: this.getFacetIds(variants),
                productFacetValueIds: this.getFacetValueIds(variants),
                productCollectionIds: unique(
                    variants.reduce(
                        (ids, variant) => [...ids, ...variant.collections.map(c => c.id)],
                        [] as ID[],
                    ),
                ),
                productCollectionSlugs: unique(productCollectionTranslations.map(c => c.slug)),
                productChannelIds: v.product.channels.map(c => c.id),
                inStock: 0 < (await this.productVariantService.getSaleableStockLevel(ctx, v)),
                productInStock: await this.getProductInStockValue(ctx, variants),
            };
            const variantCustomMappings = Object.entries(this.options.customProductVariantMappings);
            for (const [name, def] of variantCustomMappings) {
                item[`variant-${name}`] = await def.valueFn(v, languageCode, this.injector, ctx);
            }

            const productCustomMappings = Object.entries(this.options.customProductMappings);
            for (const [name, def] of productCustomMappings) {
                item[`product-${name}`] = await def.valueFn(
                    v.product,
                    variants,
                    languageCode,
                    this.injector,
                    ctx,
                );
            }
            return item;
        } catch (err: any) {
            Logger.error(err.message, loggerCtx, err.stack);
            throw err;
        }
    }

    private async getProductInStockValue(ctx: RequestContext, variants: ProductVariant[]): Promise<boolean> {
        return this.requestContextCache.get(
            ctx,
            `meilisearch-index-product-in-stock-${ctx.channelId}-${variants.map(v => v.id).join(',')}`,
            async () => {
                const stockLevels = await Promise.all(
                    variants.map(variant => this.productVariantService.getSaleableStockLevel(ctx, variant)),
                );
                return stockLevels.some(stockLevel => 0 < stockLevel);
            },
        );
    }

    /**
     * If a Product has no variants, we create a synthetic variant for the purposes
     * of making that product visible via the search query.
     */
    private async createSyntheticProductIndexItem(
        product: Product,
        ctx: RequestContext,
        languageCode: LanguageCode,
    ): Promise<VariantIndexItem> {
        const productTranslation = this.getTranslation(product, languageCode);
        const productAsset = product.featuredAsset;

        const item: VariantIndexItem = {
            id: MeilisearchIndexerController.getId(-product.id, ctx.channelId, languageCode),
            channelId: ctx.channelId,
            languageCode,
            productVariantId: 0,
            sku: '',
            slug: productTranslation.slug,
            productId: product.id,
            productName: productTranslation.name,
            productAssetId: productAsset ? productAsset.id : undefined,
            productPreview: productAsset ? productAsset.preview : '',
            productPreviewFocalPoint: productAsset ? productAsset.focalPoint || undefined : undefined,
            productVariantName: productTranslation.name,
            productVariantAssetId: undefined,
            productVariantPreview: '',
            productVariantPreviewFocalPoint: undefined,
            price: 0,
            priceWithTax: 0,
            // Note: prices are indexed in the channel's default currency only,
            // applied via productPriceApplicator.applyChannelPriceAndTax().
            // Multi-currency channels will only have the default currency indexed.
            // This is consistent with the elasticsearch-plugin's behavior.
            currencyCode: ctx.currencyCode,
            description: productTranslation.description,
            facetIds: product.facetValues?.map(fv => fv.facet.id.toString()) ?? [],
            channelIds: [ctx.channelId],
            facetValueIds: product.facetValues?.map(fv => fv.id.toString()) ?? [],
            collectionIds: [],
            collectionSlugs: [],
            enabled: false,
            productEnabled: false,
            productPriceMin: 0,
            productPriceMax: 0,
            productPriceWithTaxMin: 0,
            productPriceWithTaxMax: 0,
            productFacetIds: product.facetValues?.map(fv => fv.facet.id.toString()) ?? [],
            productFacetValueIds: product.facetValues?.map(fv => fv.id.toString()) ?? [],
            productCollectionIds: [],
            productCollectionSlugs: [],
            productChannelIds: product.channels.map(c => c.id),
            inStock: false,
            productInStock: false,
        };
        const productCustomMappings = Object.entries(this.options.customProductMappings);
        for (const [name, def] of productCustomMappings) {
            item[`product-${name}`] = await def.valueFn(product, [], languageCode, this.injector, ctx);
        }
        return item;
    }

    private getTranslation<T extends Translatable>(
        translatable: T,
        languageCode: LanguageCode,
    ): Translation<T> {
        return (translatable.translations.find(t => t.languageCode === languageCode) ||
            translatable.translations.find(t => t.languageCode === this.configService.defaultLanguageCode) ||
            translatable.translations[0]) as unknown as Translation<T>;
    }

    private getFacetIds(variants: ProductVariant[]): string[] {
        const facetIds = (fv: FacetValue) => fv.facet.id.toString();
        const variantFacetIds = variants.reduce(
            (ids, v) => [...ids, ...v.facetValues.map(facetIds)],
            [] as string[],
        );
        const productFacetIds = variants[0].product.facetValues.map(facetIds);
        return unique([...variantFacetIds, ...productFacetIds]);
    }

    private getFacetValueIds(variants: ProductVariant[]): string[] {
        const facetValueIds = (fv: FacetValue) => fv.id.toString();
        const variantFacetValueIds = variants.reduce(
            (ids, v) => [...ids, ...v.facetValues.map(facetValueIds)],
            [] as string[],
        );
        const productFacetValueIds = variants[0].product.facetValues.map(facetValueIds);
        return unique([...variantFacetValueIds, ...productFacetValueIds]);
    }

    /**
     * Best-effort deletion of an index, used to clean up a temporary reindex index
     * after a failure. Cleanup errors are swallowed so they cannot mask the original
     * failure that triggered the cleanup.
     */
    private async deleteIndexQuietly(indexUid: string): Promise<void> {
        try {
            await this.client.deleteIndex(indexUid);
            Logger.verbose(`Cleaned up index "${indexUid}"`, loggerCtx);
        } catch (e: any) {
            Logger.warn(
                `Could not clean up index "${indexUid}": ${e.message as string}`,
                loggerCtx,
            );
        }
    }

    // Note: uses `_` as separator without escaping. This assumes channel IDs and
    // entity IDs do not contain underscores. This matches the elasticsearch-plugin
    // convention. Custom ID strategies using `_` could cause collisions.
    static getId(entityId: ID, channelId: ID, languageCode: LanguageCode): string {
        return `${channelId.toString()}_${entityId.toString()}_${languageCode}`;
    }
}
