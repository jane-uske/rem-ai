/**
 * Generic module loader with fallback for .ts extension
 * Handles different module resolution patterns that can occur in different environments
 */
export function loadModule<T = unknown>(basePath: string): T {
  try {
    return require(basePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
      throw err;
    }
    return require(`${basePath}.ts`);
  }
}
