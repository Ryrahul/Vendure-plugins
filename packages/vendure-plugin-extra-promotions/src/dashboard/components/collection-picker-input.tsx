import {
    collectionRelationConfig,
    createRelationSelectorConfig,
    DashboardFormComponent,
    RelationSelector,
} from '@vendure/dashboard';

/**
 * A multi-select collection picker that uses Vendure's built-in
 * `collectionRelationConfig` to query and display collections.
 *
 * Registered as `extra-promotions-collection-picker` for use in
 * configurable operation args (PromotionCondition / PromotionAction).
 */
export const CollectionPickerInput: DashboardFormComponent = ({ value, onChange, disabled }) => {
    const multiConfig = createRelationSelectorConfig({
        ...collectionRelationConfig,
        multiple: true,
    });

    return (
        <RelationSelector
            config={multiConfig}
            value={value ?? []}
            onChange={(newValue) => onChange(newValue as string[])}
            disabled={disabled}
            selectorLabel="Select collections"
        />
    );
};

CollectionPickerInput.metadata = {
    isListInput: true,
};
