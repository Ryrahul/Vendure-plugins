import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
    overwrite: true,
    // Run `npx vendure schema` to generate this file
    // whenever your schema changes (custom fields, API extensions, etc.)
    schema: 'schema.graphql',
    config: {
        scalars: { Money: 'number' },
        namingConvention: { enumValues: 'keep' },
        // Use `T | undefined` instead of `T | null` for optional inputs,
        // matching Vendure core's type conventions.
        maybeValue: 'T | undefined',
        inputMaybeValue: 'T | undefined',
    },
    generates: {
        '../../packages/vendure-plugin-faq/src/gql/generated.ts': {
            plugins: ['typescript'],
        },
    },
};

export default config;
