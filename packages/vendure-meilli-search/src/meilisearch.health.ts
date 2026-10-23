import { Injectable } from '@nestjs/common';

import { MeilisearchService } from './meilisearch.service';

type HealthIndicatorResult = Record<string, { status: 'up' | 'down'; [key: string]: any }>;

/**
 * A health check failure in the shape `@nestjs/terminus` recognises (`isHealthCheckError` and
 * `causes`). Defined here instead of importing terminus, which Vendure 3.8 no longer ships.
 */
export class MeilisearchHealthCheckError extends Error {
    readonly isHealthCheckError = true;

    constructor(
        message: string,
        readonly causes: HealthIndicatorResult,
    ) {
        super(message);
        this.name = 'MeilisearchHealthCheckError';
    }
}

/**
 * Reports Meilisearch's status on Vendure's `/health` endpoint. Vendure only runs registered
 * indicators up to v3.5; since v3.6 they're ignored (application-level health checks are
 * deprecated in favour of infrastructure-level ones).
 */
@Injectable()
export class MeilisearchHealthIndicator {
    constructor(private meilisearchService: MeilisearchService) {}

    async isHealthy(): Promise<HealthIndicatorResult> {
        let error = '';
        try {
            if (await this.meilisearchService.ping()) {
                return { meilisearch: { status: 'up' } };
            }
        } catch (e: any) {
            error = e.message;
        }
        throw new MeilisearchHealthCheckError('Meilisearch not available', {
            meilisearch: { status: 'down', message: error },
        });
    }

    startupCheckFailed(message: string): never {
        throw new MeilisearchHealthCheckError('Meilisearch not available', {
            meilisearch: { status: 'down', message },
        });
    }
}
