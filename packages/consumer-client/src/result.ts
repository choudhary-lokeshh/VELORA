/**
 * Re-exported from `@velora/api-client`, where it lives so every product client
 * reads the same transport answers the same way. Consumer surfaces keep
 * importing it from here; there is one implementation behind both names.
 */
export { attempt, classify, isOk, type ApiResult } from '@velora/api-client';
