import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
    overwrite: true,

    schema: 'schema.graphql',
    config: {
        scalars: { Money: 'number' },
        namingConvention: { enumValues: 'keep' },
    },
    generates: {

    },
};

export default config;
