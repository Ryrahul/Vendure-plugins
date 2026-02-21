import {
    Button,
    DashboardRouteDefinition,
    ListPage,
    PageActionBarRight,
    DetailPageButton,
} from '@vendure/dashboard';
import { Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';

import { getFaqListQuery } from './faq.graphql';

export const faqList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'help-and-support',
        id: 'faq-list',
        url: '/faq',
        title: 'FAQs',
    },
    path: '/faq',
    loader: () => ({
        breadcrumb: 'FAQs',
    }),
    component: (route) => (
        <ListPage
            pageId="faq-list"
            title="FAQs"
            listQuery={getFaqListQuery}
            route={route}
            defaultVisibility={{
                id: false,
                languageCode: false,
                translations: false,
            }}
            transformVariables={(variables) => {
                return {
                    options: {
                        ...variables.options,
                        filterOperator: 'OR',
                    },
                };
            }}
            onSearchTermChange={(searchTerm) => {
                return {
                    question: {
                        contains: searchTerm,
                    },
                    answer: {
                        contains: searchTerm,
                    },
                };
            }}
            customizeColumns={{
                question: {
                    cell: ({ row }) => {
                        const post = row.original;
                        return <DetailPageButton id={post.id} label={post.question} />;
                    },
                },
                answer: {
                    cell: ({ row }) => {
                        const post = row.original;
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = post.answer || '';
                        const textContent = tempDiv.textContent || tempDiv.innerText || '';
                        const truncated =
                            textContent.length > 50 ? textContent.substring(0, 50) + '...' : textContent;
                        return <span>{truncated}</span>;
                    },
                },
                enabled: {
                    enableSorting: false,
                },
            }}
        >
            <PageActionBarRight>
                <Button asChild>
                    <Link to="./new">
                        <PlusIcon className="mr-2 h-4 w-4" />
                        New FAQ
                    </Link>
                </Button>
            </PageActionBarRight>
        </ListPage>
    ),
};
