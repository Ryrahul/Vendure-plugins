import { ID, LanguageCode } from '@vendure/core';

/**
 * Configuration options for FaqPlugin.
 * Currently empty — reserved for future options.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface FaqPluginOptions {}

// --- Input types used by the service (avoids codegen dependency) ---

export interface FaqTranslationInput {
    id?: ID;
    languageCode: LanguageCode;
    question: string;
    answer: string;
}

export interface CreateFaqInput {
    enabled: boolean;
    translations: FaqTranslationInput[];
}

export interface UpdateFaqInput {
    id: ID;
    question?: string;
    answer?: string;
    enabled?: boolean;
    translations: FaqTranslationInput[];
}

export interface FaqListOptions {
    take?: number;
    skip?: number;
    sort?: any;
    filter?: any;
    filterOperator?: 'AND' | 'OR';
}
