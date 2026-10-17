import { DataSource, EntityMetadata } from 'typeorm';

/**
 * DefaultSearchPlugin's `SearchIndexItem` entity is not exported from the
 * `@vendure/core` barrel, so it is resolved by name from the TypeORM metadata
 * instead of through a deep import. Returns `undefined` when DefaultSearchPlugin
 * is not installed.
 */
export const SEARCH_INDEX_ITEM_ENTITY_NAME = 'SearchIndexItem';

export function getSearchIndexItemMetadata(dataSource: DataSource): EntityMetadata | undefined {
    return dataSource.entityMetadatas.find(m => m.name === SEARCH_INDEX_ITEM_ENTITY_NAME);
}
