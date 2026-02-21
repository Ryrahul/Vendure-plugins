import { Entity, OneToMany, ManyToMany, JoinTable, Column, DeleteDateColumn } from 'typeorm';
import {
    Channel,
    ChannelAware,
    DeepPartial,
    LocaleString,
    Translatable,
    Translation,
    VendureEntity,
} from '@vendure/core';

import { FaqTranslation } from './faq-translation.entity';

@Entity()
export class Faq extends VendureEntity implements Translatable, ChannelAware {
    constructor(input?: DeepPartial<Faq>) {
        super(input);
    }

    @DeleteDateColumn({ nullable: true })
    deletedAt: Date | null;

    question: LocaleString;

    answer: LocaleString;

    @OneToMany(() => FaqTranslation, (translation) => translation.base, { eager: true })
    translations: Array<Translation<Faq>>;

    @Column({ type: 'boolean' })
    enabled: boolean;

    @ManyToMany(() => Channel)
    @JoinTable()
    channels: Channel[];
}
