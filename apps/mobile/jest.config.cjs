module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  // Workspace packages publish an ESM-only `exports` map, which Metro resolves
  // at build time. Jest is pointed at the same built entry points explicitly
  // rather than by loosening export conditions globally, which would also flip
  // third-party CommonJS dependencies to their ESM builds.
  moduleNameMapper: {
    // The RTC library links a native WebRTC implementation and cannot load
    // here. `src/product/live-rtc.ts` is the one module that imports it, which
    // is what makes replacing the whole transport a single line rather than a
    // mock in every test that renders Live.
    // Matched on the request as written, which is the relative `./live-rtc`
    // the one importer uses — an absolute-looking pattern never fires.
    '(?:^|/)live-rtc$': '<rootDir>/test/support/live-rtc.ts',
    '^@velora/validation/address-bounds$':
      '<rootDir>/../../packages/validation/dist/address-bounds.js',
    '^@velora/api-client$': '<rootDir>/../../packages/api-client/dist/index.js',
    '^@velora/config/client$': '<rootDir>/../../packages/config/dist/client.js',
    '^@velora/consumer-client$':
      '<rootDir>/../../packages/consumer-client/dist/index.js',
    '^@velora/design-tokens$':
      '<rootDir>/../../packages/design-tokens/dist/index.js',
    '^@velora/validation/money-bounds$':
      '<rootDir>/../../packages/validation/dist/money-bounds.js',
    '^@velora/validation/messaging-bounds$':
      '<rootDir>/../../packages/validation/dist/messaging-bounds.js',
    '^@velora/validation/notifications-bounds$':
      '<rootDir>/../../packages/validation/dist/notifications-bounds.js',
    '^@velora/validation/profile-bounds$':
      '<rootDir>/../../packages/validation/dist/profile-bounds.js',
  },
};
