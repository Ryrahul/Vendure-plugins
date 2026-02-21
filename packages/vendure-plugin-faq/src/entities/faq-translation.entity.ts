import { Column, DeepPartial, Entity, Index, ManyToOne } from 'typeorm';
import { LanguageCode, Translation, VendureEntity } from '@vendure/core';

import { Faq } from './faq.entity';

@Entity()
export class FaqTranslation extends VendureEntity implements Translation<Faq> {
    constructor(input?: DeepPartial<Translation<FaqTranslation>>) {
        super(input);
    }

    @Column('varchar')
    languageCode: LanguageCode;

    @Column()
    question: string;

    @Column({ type: 'varchar' })
    answer: string;

    @Index()
    @ManyToOne(() => Faq, (base) => base.translations, { onDelete: 'CASCADE' })
    base: Faq;
}
