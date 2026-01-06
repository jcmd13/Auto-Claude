/**
 * Debug Logger
 * Only logs when DEBUG=true in environment
 */

const isDebugEnabled = (): boolean => {
  if (typeof process !== 'undefined' && process.env) {
    return ['true', '1', 'yes', 'on'].includes((process.env.DEBUG || '').toLowerCase());
  }
  return false;
};

export const debugLog = (...args: unknown[]): void => {
  if (isDebugEnabled()) {
    console.warn(...args);
  }
};

export const debugWarn = (...args: unknown[]): void => {
  if (isDebugEnabled()) {
    console.warn(...args);
  }
};

export const debugError = (...args: unknown[]): void => {
  if (isDebugEnabled()) {
    console.error(...args);
  }
};
