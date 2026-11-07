// Compatibility entry: canonical controller state lives in a fresh module so
// ordinary config restarts reuse its private, root-scoped revision secret.
export { AuthSettingsError, authFailure, createAuthSettings, readAuthBody } from './auth-state.js';
export { installAuthSettings } from './auth-http.js';
