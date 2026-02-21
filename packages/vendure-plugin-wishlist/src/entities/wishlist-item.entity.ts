import { Customer, DeepPartial, ID, ProductVariant, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity()
@Index(['customerId', 'productVariantId'], { unique: true })
export class WishlistItem extends VendureEntity {
    constructor(input?: DeepPartial<WishlistItem>) {
        super(input);
    }

    @ManyToOne(() => Customer, { eager: false })
    @JoinColumn({ name: 'customerId' })
    customer: Customer;

    @Column()
    customerId: ID;

    @ManyToOne(() => ProductVariant, { eager: true })
    @JoinColumn({ name: 'productVariantId' })
    productVariant: ProductVariant;

    @Column()
    productVariantId: ID;
}
