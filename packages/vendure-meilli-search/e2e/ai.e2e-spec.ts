import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyIndexSettings, getClient } from '../src/indexing/indexing-utils';
import { MeilisearchOptions, mergeWithDefaults } from '../src/options';

import { createMeiliTestEnvironment, deleteIndexes, MEILI_HOST, MEILI_KEY, meiliClient, serverInitOptions } from './utils/test-environment';

const PREFIX = 'e2e-ai-';
const INDEX = `${PREFIX}variants`;

// A fake key: Meilisearch accepts the embedder settings and only calls OpenAI when embedding,
// which these tests never trigger (no reindex).
const AI: MeilisearchOptions['ai'] = {
    embedders: {
        default: { source: 'openAi', model: 'text-embedding-3-small', apiKey: 'sk-fake-key-for-tests', documentTemplate: '{{doc.productName}}' },
    },
    semanticRatio: 0.5,
};

describe('AI embedder settings and hybrid fallback', () => {
    const { server, shopClient } = createMeiliTestEnvironment(PREFIX, { ai: AI });

    beforeAll(async () => {
        await deleteIndexes(PREFIX);
        await server.init({ ...serverInitOptions, productsCsvPath: undefined });
    });

    afterAll(async () => {
        await server.destroy();
        await deleteIndexes(PREFIX);
    });

    it('configures the embedder on a new index', async () => {
        const { embedders } = await meiliClient().index(INDEX).getSettings();
        expect(embedders?.default).toMatchObject({ source: 'openAi', model: 'text-embedding-3-small' });
    });

    it('does not resend the embedder because of the masked API key', async () => {
        const options = mergeWithDefaults({ host: MEILI_HOST, apiKey: MEILI_KEY, indexPrefix: PREFIX, ai: AI });
        expect(await applyIndexSettings(getClient(options), INDEX, options)).toEqual([]);
    });

    it('removes an embedder that is no longer configured', async () => {
        const options = mergeWithDefaults({ host: MEILI_HOST, apiKey: MEILI_KEY, indexPrefix: PREFIX });
        expect(await applyIndexSettings(getClient(options), INDEX, options)).toHaveLength(1);
        expect((await meiliClient().index(INDEX).getSettings()).embedders).toEqual({});
    });

    it('falls back to keyword search when the embedder is missing on the index', async () => {
        // The embedder was removed above, while the server still has `ai` configured (as during a reindex swap)
        const result = await shopClient.query(gql`
            query {
                search(input: { term: "anything" }) {
                    totalItems
                }
            }
        `);
        expect(result.search.totalItems).toBe(0);
    });
});
