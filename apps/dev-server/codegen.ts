import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
    overwrite: true,
    // Run `npx vendure schema` to generate this file
    // whenever your schema changes (custom fields, API extensions, etc.)
    schema: 'schema.graphql',
    config: {
        scalars: { Money: 'number' },
        namingConvention: { enumValues: 'keep' },
    },
    generates: {
        // Add one entry per plugin that needs generated types, e.g.:
        // '../../packages/vendure-plugin-foo/src/gql/generated.ts': {
        //     plugins: ['typescript'],
        // },
    },
};

export default config;
