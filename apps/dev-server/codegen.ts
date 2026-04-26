import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
    overwrite: true,
    config: {
        maybeValue: 'T',
        scalars: { ID: 'string | number', Money: 'number' },
        namingConvention: { enumValues: 'keep' },
    },
    generates: {
        'src/codegen/adminTypes.ts': {
            schema: 'http://localhost:3000/admin-api',
            plugins: ['typescript', 'typescript-operations', 'typed-document-node'],
        },
        'src/codegen/shopTypes.ts': {
            schema: 'http://localhost:3000/shop-api',
            plugins: ['typescript', 'typescript-operations', 'typed-document-node'],
        },
    },
};

export default config;
