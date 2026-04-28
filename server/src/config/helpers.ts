import dotenv from 'dotenv';

dotenv.config();

export function createCachedConfig<T>(load: () => T) {
  let cached: T | undefined;

  return () => {
    if (cached === undefined) {
      cached = load();
    }

    return cached;
  };
}
