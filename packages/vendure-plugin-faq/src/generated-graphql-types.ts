export type Maybe<T> = T | undefined;
export type InputMaybe<T> = T | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  DateTime: { input: Date; output: Date; }
  LanguageCode: { input: import('@vendure/common/lib/generated-types').LanguageCode; output: import('@vendure/common/lib/generated-types').LanguageCode; }
};

export type AssignFaqsToChannelsInput = {
  channelIds: Array<Scalars['ID']['input']>;
  faqIds: Array<Scalars['ID']['input']>;
};

export type CreateFaqInput = {
  enabled: Scalars['Boolean']['input'];
  translations: Array<FaqTranslationInput>;
};

export type DeletionResponse = {
  __typename?: 'DeletionResponse';
  message?: Maybe<Scalars['String']['output']>;
  result: DeletionResult;
};

export enum DeletionResult {
  DELETED = 'DELETED',
  NOT_DELETED = 'NOT_DELETED'
}

export type Faq = Node & {
  __typename?: 'Faq';
  answer?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  languageCode?: Maybe<Scalars['LanguageCode']['output']>;
  question?: Maybe<Scalars['String']['output']>;
  translations: Array<FaqTranslation>;
  updatedAt: Scalars['DateTime']['output'];
};

export type FaqList = PaginatedList & {
  __typename?: 'FaqList';
  items: Array<Faq>;
  totalItems: Scalars['Int']['output'];
};

export type FaqListOptions = {};

export type FaqTranslation = Node & {
  __typename?: 'FaqTranslation';
  answer: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  languageCode: Scalars['LanguageCode']['output'];
  question: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type FaqTranslationInput = {
  answer: Scalars['String']['input'];
  id?: InputMaybe<Scalars['ID']['input']>;
  languageCode: Scalars['LanguageCode']['input'];
  question: Scalars['String']['input'];
};

export type Mutation = {
  __typename?: 'Mutation';
  assignFaqsToChannels: Array<Faq>;
  createFaq: Faq;
  deleteFaq: DeletionResponse;
  removeFaqsFromCurrentChannel: Array<Faq>;
  updateFaq: Faq;
};


export type MutationAssignFaqsToChannelsArgs = {
  input: AssignFaqsToChannelsInput;
};


export type MutationCreateFaqArgs = {
  input: CreateFaqInput;
};


export type MutationDeleteFaqArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type MutationRemoveFaqsFromCurrentChannelArgs = {
  faqIds: Array<Scalars['ID']['input']>;
};


export type MutationUpdateFaqArgs = {
  input: UpdateFaqInput;
};

export type Node = {
  id: Scalars['ID']['output'];
};

export type PaginatedList = {
  items: Array<Node>;
  totalItems: Scalars['Int']['output'];
};

export type Query = {
  __typename?: 'Query';
  faq?: Maybe<Faq>;
  faqs: FaqList;
};


export type QueryFaqArgs = {
  id: Scalars['ID']['input'];
};


export type QueryFaqsArgs = {
  options?: InputMaybe<FaqListOptions>;
};

export type UpdateFaqInput = {
  answer?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
  question?: InputMaybe<Scalars['String']['input']>;
  translations: Array<FaqTranslationInput>;
};
