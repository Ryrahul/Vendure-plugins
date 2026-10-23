import { Meilisearch } from 'meilisearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    applyIndexSettings,
    createIndex,
    MeilisearchTaskFailedError,
    waitForTask,
} from '../src/indexing/indexing-utils';
import { MeilisearchOptions, mergeWithDefaults } from '../src/options';

import { deleteIndexes, MEILI_HOST, MEILI_KEY, meiliClient } from './utils/test-environment';

const PREFIX = 'e2e-settings-';
const INDEX = `${PREFIX}variants`;

const options = (extra: Partial<MeilisearchOptions> = {}) =>
    mergeWithDefaults({ host: MEILI_HOST, apiKey: MEILI_KEY, ...extra });

describe('index settings sync', () => {
    const client = meiliClient();

    beforeAll(async () => {
        await deleteIndexes(PREFIX);
        await createIndex(client, INDEX, 'id');
    });

    afterAll(async () => {
        await deleteIndexes(PREFIX);
    });

    it('configures a new index in one settings task', async () => {
        const tasks = await applyIndexSettings(client, INDEX, options({ synonyms: { tv: ['television'] } }));
        expect(tasks).toHaveLength(1);
        const settings = await client.index(INDEX).getSettings();
        expect(settings.synonyms).toEqual({ television: ['tv'], tv: ['television'] });
        expect(settings.faceting?.sortFacetValuesBy).toEqual({ '*': 'count' });
    });

    it('sends nothing when the settings are unchanged', async () => {
        expect(await applyIndexSettings(client, INDEX, options({ synonyms: { tv: ['television'] } }))).toEqual([]);
    });

    it('resets options that were removed from the config', async () => {
        const tasks = await applyIndexSettings(client, INDEX, options());
        expect(tasks).toHaveLength(1);
        const settings = await client.index(INDEX).getSettings();
        expect(settings.synonyms).toEqual({});
        expect(await applyIndexSettings(client, INDEX, options())).toEqual([]);
    });

    it('applies indexSettings passthrough options', async () => {
        await applyIndexSettings(client, INDEX, options({ indexSettings: { searchCutoffMs: 250 } }));
        expect((await client.index(INDEX).getSettings()).searchCutoffMs).toBe(250);
        expect(await applyIndexSettings(client, INDEX, options({ indexSettings: { searchCutoffMs: 250 } }))).toEqual([]);
    });

    it('throws when a task fails instead of treating it as a success', async () => {
        const task = await client.index(INDEX).addDocuments([{ id: 'not valid!' }]);
        const error = await waitForTask(client, task.taskUid).catch(e => e);
        expect(error).toBeInstanceOf(MeilisearchTaskFailedError);
        expect(error.message).toContain('invalid_document_id');
    });

    it('does not mistake other errors for a missing index', async () => {
        const badClient = new Meilisearch({ host: MEILI_HOST, apiKey: 'wrong-key' });
        await expect(createIndex(badClient, `${PREFIX}other`, 'id')).rejects.toThrow();
        const { results } = await client.getIndexes({ limit: 1000 });
        expect(results.map(i => i.uid)).not.toContain(`${PREFIX}other`);
    });
});
