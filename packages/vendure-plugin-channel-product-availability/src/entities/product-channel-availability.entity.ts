import { Channel, DeepPartial, EntityId, ID, Product, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

/**
 * An explicit per-channel override of `Product.enabled`.
 *
 * Rows are sparse: no row means the product inherits the global flag in that
 * channel. At most one row exists per (product, channel).
 */
@Entity()
@Index(['productId', 'channelId'], { unique: true })
@Index(['channelId', 'enabled'])
export class ProductChannelAvailability extends VendureEntity {
    constructor(input?: DeepPartial<ProductChannelAvailability>) {
        super(input);
    }

    @ManyToOne(() => Product, { onDelete: 'CASCADE', nullable: false })
    product: Product;

    @EntityId()
    productId: ID;

    @ManyToOne(() => Channel, { onDelete: 'CASCADE', nullable: false })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'boolean' })
    enabled: boolean;
}
