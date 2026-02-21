import { Injectable } from '@nestjs/common';
import { DeletionResponse, DeletionResult } from '@vendure/common/lib/generated-types';
import { In, IsNull } from 'typeorm';
import {
    assertFound,
    ChannelService,
    ID,
    idsAreEqual,
    ListQueryBuilder,
    ListQueryOptions,
    RequestContext,
    TransactionalConnection,
    TranslatableSaver,
    TranslatorService,
    UserInputError,
} from '@vendure/core';

import { Faq } from '../entities/faq.entity';
import { FaqTranslation } from '../entities/faq-translation.entity';
import { CreateFaqInput, UpdateFaqInput } from '../types';

@Injectable()
export class FaqService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private translator: TranslatorService,
        private translatableSaver: TranslatableSaver,
        private channelService: ChannelService,
    ) {}

    async findAll(ctx: RequestContext, options?: ListQueryOptions<Faq>) {
        return this.listQueryBuilder
            .build(Faq, options, {
                ctx,
                channelId: ctx.channelId,
                where: { deletedAt: IsNull() },
            })
            .getManyAndCount()
            .then(([faqs, totalItems]) => {
                const items = faqs.map((faq) => this.translator.translate(faq, ctx));
                return { items, totalItems };
            });
    }

    async findOne(ctx: RequestContext, id: ID) {
        return this.connection
            .findOneInChannel(ctx, Faq, id, ctx.channelId, {
                where: { deletedAt: IsNull() },
            })
            .then((faq) => {
                if (faq) {
                    return this.translator.translate(faq, ctx);
                }
            });
    }

    async findByIds(ctx: RequestContext, ids: ID[]): Promise<Faq[]> {
        return this.connection
            .findByIdsInChannel(ctx, Faq, ids, ctx.channelId, {
                where: { deletedAt: IsNull() },
            })
            .then((faqs) => faqs.map((faq) => this.translator.translate(faq, ctx)));
    }

    async create(ctx: RequestContext, input: CreateFaqInput) {
        const faq = await this.translatableSaver.create({
            ctx,
            input,
            entityType: Faq,
            translationType: FaqTranslation,
            beforeSave: async (f) => {
                await this.channelService.assignToCurrentChannel(f, ctx);
            },
        });
        return assertFound(this.findOne(ctx, faq.id));
    }

    async update(ctx: RequestContext, input: UpdateFaqInput) {
        const updated = await this.translatableSaver.update({
            ctx,
            input,
            entityType: Faq,
            translationType: FaqTranslation,
        });
        return assertFound(this.findOne(ctx, updated.id));
    }

    async delete(ctx: RequestContext, ids: ID[]): Promise<DeletionResponse> {
        if (ids.length === 0) {
            throw new UserInputError('error.no-ids-provided');
        }

        const qb = this.connection.getRepository(ctx, Faq).createQueryBuilder('faq');
        const existingFaqIds = await qb
            .leftJoin('faq.channels', 'channel')
            .andWhere('faq.id IN (:...ids)', { ids })
            .andWhere('channel.id = :channelId', { channelId: ctx.channelId })
            .andWhere('faq.deletedAt IS NULL')
            .select('faq.id')
            .getMany()
            .then((faqs) => faqs.map((faq) => faq.id));

        const nonExistingIds = ids.filter((id) => !existingFaqIds.includes(id));
        if (nonExistingIds.length > 0) {
            throw new UserInputError(
                `FAQ(s) with ID(s) ${nonExistingIds.join(', ')} not found or unavailable in this channel.`,
            );
        }

        const deleteResult = await this.connection.getRepository(ctx, Faq).softDelete({
            id: In(existingFaqIds),
        });

        if ((deleteResult.affected ?? 0) > 0) {
            return {
                message: `${deleteResult.affected} FAQ(s) deleted successfully.`,
                result: DeletionResult.DELETED,
            };
        }

        return {
            message: 'No FAQs were deleted.',
            result: DeletionResult.NOT_DELETED,
        };
    }

    async assignToChannels(ctx: RequestContext, faqIds: ID[], channelIds: ID[]): Promise<Faq[]> {
        for (const faqId of faqIds) {
            await this.channelService.assignToChannels(ctx, Faq, faqId, channelIds);
        }
        return this.findByIds(ctx, faqIds);
    }

    async removeFromCurrentChannel(ctx: RequestContext, faqIds: ID[]): Promise<Faq[]> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(ctx.channelId, defaultChannel.id)) {
            throw new UserInputError('error.items-cannot-be-removed-from-default-channel');
        }
        for (const faqId of faqIds) {
            await this.channelService.removeFromChannels(ctx, Faq, faqId, [ctx.channelId]);
        }
        return this.findByIds(ctx, faqIds);
    }
}
