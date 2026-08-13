module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  // Workspace packages publish an ESM-only `exports` map, which Metro resolves
  // at build time. Jest is pointed at the same built entry points explicitly
  // rather than by loosening export conditions globally, which would also flip
  // third-party CommonJS dependencies to their ESM builds.
  moduleNameMapper: {
    '^@velora/api-client$': '<rootDir>/../../packages/api-client/dist/index.js',
    '^@velora/config/client$': '<rootDir>/../../packages/config/dist/client.js',
    '^@velora/design-tokens$':
      '<rootDir>/../../packages/design-tokens/dist/index.js',
  },
};
