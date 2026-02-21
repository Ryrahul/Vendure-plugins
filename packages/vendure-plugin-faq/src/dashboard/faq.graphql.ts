import { graphql } from '@/gql';

const faqFragment = graphql(`
    fragment FaqFragment on Faq {
        id
        question
        answer
        enabled
        languageCode
        translations {
            id
            question
            languageCode
            answer
        }
        createdAt
        updatedAt
    }
`);

export const getFaqListQuery = graphql(
    `
        query GetFaqList($options: FaqListOptions) {
            faqs(options: $options) {
                items {
                    ...FaqFragment
                }
                totalItems
            }
        }
    `,
    [faqFragment],
);

export const getFaqDetailQuery = graphql(
    `
        query GetFaqDetail($id: ID!) {
            faq(id: $id) {
                ...FaqFragment
            }
        }
    `,
    [faqFragment],
);

export const createFaqMutation = graphql(
    `
        mutation CreateFaq($input: CreateFaqInput!) {
            createFaq(input: $input) {
                ...FaqFragment
            }
        }
    `,
    [faqFragment],
);

export const updateFaqMutation = graphql(
    `
        mutation UpdateFaq($input: UpdateFaqInput!) {
            updateFaq(input: $input) {
                ...FaqFragment
            }
        }
    `,
    [faqFragment],
);

export const deleteFaqMutation = graphql(`
    mutation DeleteFaqs($ids: [ID!]!) {
        deleteFaq(ids: $ids) {
            message
            result
        }
    }
`);

export const assignFaqsToChannelsMutation = graphql(
    `
        mutation AssignFaqsToChannels($input: AssignFaqsToChannelsInput!) {
            assignFaqsToChannels(input: $input) {
                ...FaqFragment
            }
        }
    `,
    [faqFragment],
);

export const removeFaqsFromCurrentChannelMutation = graphql(
    `
        mutation RemoveFaqsFromCurrentChannel($faqIds: [ID!]!) {
            removeFaqsFromCurrentChannel(faqIds: $faqIds) {
                ...FaqFragment
            }
        }
    `,
    [faqFragment],
);

export const getChannelsQuery = graphql(`
    query GetAllChannels {
        channels {
            items {
                id
                code
                token
            }
        }
    }
`);
