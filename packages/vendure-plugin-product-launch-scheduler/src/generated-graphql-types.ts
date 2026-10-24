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
};

export type CreateProductLaunchScheduleInput = {
  action: ProductLaunchAction;
  description?: InputMaybe<Scalars['String']['input']>;
  /** Defaults to DISABLE when endAt is set. */
  endAction?: InputMaybe<ProductLaunchEndAction>;
  /** Local end time, YYYY-MM-DDTHH:mm, in timezone. */
  endAt?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  productId: Scalars['ID']['input'];
  /** Local start time, YYYY-MM-DDTHH:mm, in timezone. */
  scheduledAt: Scalars['String']['input'];
  /** IANA time zone, e.g. Europe/Berlin. */
  timezone: Scalars['String']['input'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Cancels a PENDING or ACTIVE schedule. Cancelling an ACTIVE one skips its end step and leaves the product as it is. */
  cancelProductLaunchSchedule: ProductLaunchSchedule;
  /** Schedules a change of the product's global enabled state. Affects every channel. */
  createProductLaunchSchedule: ProductLaunchSchedule;
  /** Runs a FAILED schedule's step again at the next poll. */
  retryProductLaunchSchedule: ProductLaunchSchedule;
  updateProductLaunchSchedule: ProductLaunchSchedule;
};


export type MutationCancelProductLaunchScheduleArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCreateProductLaunchScheduleArgs = {
  input: CreateProductLaunchScheduleInput;
};


export type MutationRetryProductLaunchScheduleArgs = {
  id: Scalars['ID']['input'];
};


export type MutationUpdateProductLaunchScheduleArgs = {
  input: UpdateProductLaunchScheduleInput;
};

export type Node = {
  id: Scalars['ID']['output'];
};

export type PaginatedList = {
  items: Array<Node>;
  totalItems: Scalars['Int']['output'];
};

export type Product = Node & {
  __typename?: 'Product';
  id: Scalars['ID']['output'];
};

/** The global Product.enabled value a start step sets. */
export type ProductLaunchAction =
  | 'DISABLE'
  | 'ENABLE';

/**
 * What happens at the end time. RESTORE puts back the value from before the start step, unless
 * the product was changed manually in between (then nothing is changed).
 */
export type ProductLaunchEndAction =
  | 'DISABLE'
  | 'ENABLE'
  | 'RESTORE';

export type ProductLaunchExecutionOutcome =
  | 'FAILED'
  | 'NO_CHANGE'
  | 'SKIPPED'
  | 'SUCCEEDED';

/** A scheduled change of a product's global enabled state. It applies to every channel. */
export type ProductLaunchSchedule = Node & {
  __typename?: 'ProductLaunchSchedule';
  action: ProductLaunchAction;
  /** Attempts of the current step. */
  attempts: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  createdByUserId?: Maybe<Scalars['ID']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  endAction?: Maybe<ProductLaunchEndAction>;
  /** UTC instant of the end step, if any. */
  endAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  lastError?: Maybe<Scalars['String']['output']>;
  lastExecutedAt?: Maybe<Scalars['DateTime']['output']>;
  /** The end time as entered. */
  localEndAt?: Maybe<Scalars['String']['output']>;
  /** The start time as entered (YYYY-MM-DDTHH:mm in timezone). */
  localScheduledAt: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  /** When the next step is due (UTC). Later than the scheduled time while a failed step waits to be retried. */
  nextRunAt?: Maybe<Scalars['DateTime']['output']>;
  nextStep?: Maybe<ProductLaunchStep>;
  /** Null if the product is not in the active channel. */
  product?: Maybe<Product>;
  productId: Scalars['ID']['output'];
  /** UTC instant of the start step. */
  scheduledAt: Scalars['DateTime']['output'];
  startEnabledAfter?: Maybe<Scalars['Boolean']['output']>;
  startEnabledBefore?: Maybe<Scalars['Boolean']['output']>;
  status: ProductLaunchScheduleStatus;
  /** The IANA time zone the times were entered in. */
  timezone: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ProductLaunchScheduleExecution = Node & {
  __typename?: 'ProductLaunchScheduleExecution';
  /** ENABLE, DISABLE or RESTORE */
  action: Scalars['String']['output'];
  attempt: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  enabledAfter?: Maybe<Scalars['Boolean']['output']>;
  enabledBefore?: Maybe<Scalars['Boolean']['output']>;
  executedAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  message?: Maybe<Scalars['String']['output']>;
  outcome: ProductLaunchExecutionOutcome;
  ranLateBySeconds: Scalars['Int']['output'];
  scheduleId: Scalars['ID']['output'];
  step: ProductLaunchStep;
};

export type ProductLaunchScheduleExecutionList = PaginatedList & {
  __typename?: 'ProductLaunchScheduleExecutionList';
  items: Array<ProductLaunchScheduleExecution>;
  totalItems: Scalars['Int']['output'];
};

export type ProductLaunchScheduleExecutionListOptions = {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
};

export type ProductLaunchScheduleList = PaginatedList & {
  __typename?: 'ProductLaunchScheduleList';
  items: Array<ProductLaunchSchedule>;
  totalItems: Scalars['Int']['output'];
};

export type ProductLaunchScheduleListOptions = {
  /** Schedules whose start or end is at or after this instant. */
  from?: InputMaybe<Scalars['DateTime']['input']>;
  productId?: InputMaybe<Scalars['ID']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  sortBy?: InputMaybe<ProductLaunchScheduleSortField>;
  sortOrder?: InputMaybe<SortOrder>;
  status?: InputMaybe<Array<ProductLaunchScheduleStatus>>;
  take?: InputMaybe<Scalars['Int']['input']>;
  /** Schedules whose start is at or before this instant. */
  to?: InputMaybe<Scalars['DateTime']['input']>;
};

export type ProductLaunchScheduleSortField =
  | 'createdAt'
  | 'nextRunAt'
  | 'scheduledAt'
  | 'updatedAt';

/**
 * PENDING: waiting for the start step. ACTIVE: started, waiting for the end step.
 * PROCESSING: a step is running. COMPLETED, FAILED, CANCELLED: finished.
 */
export type ProductLaunchScheduleStatus =
  | 'ACTIVE'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'FAILED'
  | 'PENDING'
  | 'PROCESSING';

export type ProductLaunchSchedulerStatus = {
  __typename?: 'ProductLaunchSchedulerStatus';
  maxAttempts: Scalars['Int']['output'];
  /** The cron expression schedules are processed on. */
  pollSchedule: Scalars['String']['output'];
  /** False when no scheduler strategy is configured (e.g. DefaultSchedulerPlugin is missing): nothing will run. */
  schedulerRunning: Scalars['Boolean']['output'];
};

export type ProductLaunchStep =
  | 'END'
  | 'START';

/** The result of converting a local time, for previews in a UI. */
export type ProductLaunchTimePreview = {
  __typename?: 'ProductLaunchTimePreview';
  /** The local time happens twice (DST); the earlier instant is used. */
  ambiguous: Scalars['Boolean']['output'];
  /** INVALID_TIMEZONE, INVALID_LOCAL_TIME or INVALID_INPUT, when not valid. */
  errorCode?: Maybe<Scalars['String']['output']>;
  /** UTC instant, when valid. */
  instant?: Maybe<Scalars['DateTime']['output']>;
  /** For a time skipped by DST: the first valid local time after it. */
  nextValidLocalTime?: Maybe<Scalars['String']['output']>;
  valid: Scalars['Boolean']['output'];
};

export type Query = {
  __typename?: 'Query';
  productLaunchSchedule?: Maybe<ProductLaunchSchedule>;
  productLaunchScheduleExecutions: ProductLaunchScheduleExecutionList;
  productLaunchSchedulerStatus: ProductLaunchSchedulerStatus;
  /** Schedules of products in the active channel. */
  productLaunchSchedules: ProductLaunchScheduleList;
  /** Converts a local time to UTC without saving anything (for previews and validation in a UI). */
  productLaunchTimePreview: ProductLaunchTimePreview;
};


export type QueryProductLaunchScheduleArgs = {
  id: Scalars['ID']['input'];
};


export type QueryProductLaunchScheduleExecutionsArgs = {
  options?: InputMaybe<ProductLaunchScheduleExecutionListOptions>;
  scheduleId: Scalars['ID']['input'];
};


export type QueryProductLaunchSchedulesArgs = {
  options?: InputMaybe<ProductLaunchScheduleListOptions>;
};


export type QueryProductLaunchTimePreviewArgs = {
  localTime: Scalars['String']['input'];
  timezone: Scalars['String']['input'];
};

export type SortOrder =
  | 'ASC'
  | 'DESC';

/** A PENDING schedule can be changed entirely; an ACTIVE one (started) only its end. */
export type UpdateProductLaunchScheduleInput = {
  action?: InputMaybe<ProductLaunchAction>;
  description?: InputMaybe<Scalars['String']['input']>;
  endAction?: InputMaybe<ProductLaunchEndAction>;
  endAt?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  /** Removes the end step. */
  removeEnd?: InputMaybe<Scalars['Boolean']['input']>;
  scheduledAt?: InputMaybe<Scalars['String']['input']>;
  timezone?: InputMaybe<Scalars['String']['input']>;
};
