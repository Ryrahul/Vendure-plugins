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

export type ClearProductChannelAvailabilityInput = {
  /** Defaults to the active channel. */
  channelId?: InputMaybe<Scalars['ID']['input']>;
  productId: Scalars['ID']['input'];
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

export type Mutation = {
  __typename?: 'Mutation';
  /** Removes the override so the product inherits Product.enabled again. */
  clearProductChannelAvailability: ProductChannelAvailability;
  /** Sets an explicit override. Does not change Product.enabled or channel assignment. */
  setProductChannelAvailability: ProductChannelAvailability;
};


export type MutationClearProductChannelAvailabilityArgs = {
  input: ClearProductChannelAvailabilityInput;
};


export type MutationSetProductChannelAvailabilityArgs = {
  input: SetProductChannelAvailabilityInput;
};

export type Node = {
  id: Scalars['ID']['output'];
};

export type PaginatedList = {
  items: Array<Node>;
  totalItems: Scalars['Int']['output'];
};

export type ProductChannelAvailability = {
  __typename?: 'ProductChannelAvailability';
  channelCode: Scalars['String']['output'];
  channelId: Scalars['ID']['output'];
  /** What the storefront and checkout enforce in this channel. */
  effectiveEnabled: Scalars['Boolean']['output'];
  /** The global Product.enabled value. */
  globalEnabled: Scalars['Boolean']['output'];
  /** The explicit override for this channel, or null when inherited. */
  override?: Maybe<Scalars['Boolean']['output']>;
  overrideState: ProductChannelAvailabilityOverrideState;
  productId: Scalars['ID']['output'];
  productInChannel: Scalars['Boolean']['output'];
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type ProductChannelAvailabilityOverride = {
  __typename?: 'ProductChannelAvailabilityOverride';
  channelId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  productId: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ProductChannelAvailabilityOverrideList = {
  __typename?: 'ProductChannelAvailabilityOverrideList';
  items: Array<ProductChannelAvailabilityOverride>;
  totalItems: Scalars['Int']['output'];
};

export type ProductChannelAvailabilityOverrideListOptions = {
  /** Defaults to the active channel. */
  channelId?: InputMaybe<Scalars['ID']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  productId?: InputMaybe<Scalars['ID']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

/**
 * INHERITED: no override, the global Product.enabled applies.
 * ENABLED / DISABLED: explicit channel override, takes precedence over Product.enabled.
 */
export enum ProductChannelAvailabilityOverrideState {
  DISABLED = 'DISABLED',
  ENABLED = 'ENABLED',
  INHERITED = 'INHERITED'
}

export type Query = {
  __typename?: 'Query';
  /** Availability of a product in every channel it is assigned to that the current administrator can read. */
  productChannelAvailabilities: Array<ProductChannelAvailability>;
  /** Availability of a product in one channel (default: the active channel). */
  productChannelAvailability: ProductChannelAvailability;
  /** Explicit overrides in a channel (default: the active channel). */
  productChannelAvailabilityOverrides: ProductChannelAvailabilityOverrideList;
};


export type QueryProductChannelAvailabilitiesArgs = {
  productId: Scalars['ID']['input'];
};


export type QueryProductChannelAvailabilityArgs = {
  channelId?: InputMaybe<Scalars['ID']['input']>;
  productId: Scalars['ID']['input'];
};


export type QueryProductChannelAvailabilityOverridesArgs = {
  options?: InputMaybe<ProductChannelAvailabilityOverrideListOptions>;
};

export type SetProductChannelAvailabilityInput = {
  /** Defaults to the active channel. */
  channelId?: InputMaybe<Scalars['ID']['input']>;
  enabled: Scalars['Boolean']['input'];
  productId: Scalars['ID']['input'];
};
