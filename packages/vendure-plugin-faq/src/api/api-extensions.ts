import gql from 'graphql-tag';

const common = gql`
    type Faq implements Node {
        id: ID!
        question: String
        answer: String
        enabled: Boolean!
        languageCode: LanguageCode
        translations: [FaqTranslation!]!
        createdAt: DateTime!
        updatedAt: DateTime!
    }

    type FaqTranslation implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        languageCode: LanguageCode!
        question: String!
        answer: String!
    }

    type FaqList implements PaginatedList {
        items: [Faq!]!
        totalItems: Int!
    }

    input FaqListOptions
`;

export const shopApiExtensions = gql`
    ${common}
    extend type Query {
        faqs(options: FaqListOptions): FaqList!
    }
`;

export const adminApiExtensions = gql`
    ${common}

    input FaqTranslationInput {
        id: ID
        languageCode: LanguageCode!
        question: String!
        answer: String!
    }

    input CreateFaqInput {
        enabled: Boolean!
        translations: [FaqTranslationInput!]!
    }

    input UpdateFaqInput {
        id: ID!
        question: String
        answer: String
        enabled: Boolean
        translations: [FaqTranslationInput!]!
    }

    input AssignFaqsToChannelsInput {
        channelIds: [ID!]!
        faqIds: [ID!]!
    }

    extend type Mutation {
        createFaq(input: CreateFaqInput!): Faq!
        updateFaq(input: UpdateFaqInput!): Faq!
        deleteFaq(ids: [ID!]!): DeletionResponse!
        assignFaqsToChannels(input: AssignFaqsToChannelsInput!): [Faq!]!
        removeFaqsFromCurrentChannel(faqIds: [ID!]!): [Faq!]!
    }

    extend type Query {
        faq(id: ID!): Faq
        faqs(options: FaqListOptions): FaqList!
    }
`;
