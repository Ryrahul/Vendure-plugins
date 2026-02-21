import { AnyRoute, useNavigate } from '@tanstack/react-router';
import {
    Button,
    DashboardRouteDefinition,
    detailPageRouteLoader,
    FormFieldWrapper,
    Input,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    PermissionGuard,
    RichTextInput,
    Switch,
    TranslatableFormFieldWrapper,
    useDetailPage,
} from '@vendure/dashboard';
import { toast } from 'sonner';

import { createFaqMutation, getFaqDetailQuery, updateFaqMutation } from './faq.graphql';

export const faqDetail: DashboardRouteDefinition = {
    path: '/faq/$id',
    loader: detailPageRouteLoader({
        queryDocument: getFaqDetailQuery,
        breadcrumb: (isNew, entity) => [
            { path: '/faq', label: 'FAQs' },
            isNew ? 'New FAQ' : entity?.id,
        ],
    }),
    component: (route) => {
        return <FaqDetailPage route={route as AnyRoute} />;
    },
};

function FaqDetailPage({ route }: { route: AnyRoute }) {
    const params = route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === 'new';

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        queryDocument: getFaqDetailQuery,
        createDocument: createFaqMutation,
        updateDocument: updateFaqMutation,
        setValuesForUpdate: (entity) => {
            return {
                id: entity?.id ?? '',
                enabled: entity?.enabled ?? false,
                translations: entity.translations.map((translation) => ({
                    id: translation.id,
                    languageCode: translation.languageCode,
                    question: translation.question,
                    answer: translation.answer,
                })),
            };
        },
        params: { id: params.id },
        onSuccess: async (data) => {
            toast.success(creatingNewEntity ? 'Successfully created FAQ' : 'Successfully updated FAQ');
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } as any });
            }
        },
        onError: (err) => {
            toast.error(creatingNewEntity ? 'Failed to create FAQ' : 'Failed to update FAQ', {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    return (
        <Page pageId="faq-list" form={form} submitHandler={submitHandler}>
            <PageTitle>{creatingNewEntity ? 'New FAQ' : (entity?.question ?? '')}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <PermissionGuard requires={['CreateFaq', 'UpdateFaq']}>
                        <Button
                            type="submit"
                            disabled={
                                !form.formState.isDirty || !form.formState.isValid || isPending
                            }
                        >
                            {creatingNewEntity ? 'Create' : 'Update'}
                        </Button>
                    </PermissionGuard>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="side" blockId="enabled-toggle">
                    <FormFieldWrapper
                        control={form.control}
                        name="enabled"
                        label="Enabled"
                        description="When enabled, a FAQ is available in the shop"
                        render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                        )}
                    />
                </PageBlock>
                <PageBlock column="main" blockId="main-form">
                    <div className="grid gap-6 items-start mb-6">
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="question"
                            label="Question"
                            render={({ field }) => <Input {...(field as any)} />}
                        />
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="answer"
                            label="Answer"
                            render={({ field }) => <RichTextInput {...field} />}
                        />
                    </div>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
