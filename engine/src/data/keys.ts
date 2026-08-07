import { atomicWriteJSON, readJSONSafe, withFileLock } from '../fs';
import { paths } from '../paths';

export const PROVIDERS = ['fred', 'alphavantage', 'polygon', 'fmp'] as const;
export type Provider = (typeof PROVIDERS)[number];

type KeyStore = Partial<Record<Provider, string>>;

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

function load(file: string): KeyStore {
  return readJSONSafe<KeyStore>(file, {});
}

function save(data: KeyStore, file: string): void {
  atomicWriteJSON(file, data, 0o600);
}

/**
 * Read-modify-write keys.json under a file lock. Setting two providers
 * concurrently would otherwise drop one — rare in interactive use, but the
 * failure is silent and the fix is free.
 */
function mutate(file: string, fn: (data: KeyStore) => void): void {
  withFileLock(file, () => {
    const data = load(file);
    fn(data);
    save(data, file);
  });
}

/** Re-exported so callers do not need to import paths just to name the file. */
export const KEYS_FILE = paths.KEYS_FILE;

export function getKey(provider: string, file = paths.KEYS_FILE): string | null {
  return load(file)[provider as Provider] ?? null;
}

export function setKey(provider: string, key: string, file = paths.KEYS_FILE): void {
  mutate(file, data => {
    data[provider as Provider] = key;
  });
}

export function removeKey(provider: string, file = paths.KEYS_FILE): void {
  mutate(file, data => {
    delete data[provider as Provider];
  });
}

export function listKeys(
  file = paths.KEYS_FILE,
): { provider: string; configured: boolean; masked: string }[] {
  const data = load(file);
  return Object.entries(data)
    .filter(([, v]) => v)
    .map(([provider, key]) => ({
      provider,
      configured: true,
      masked: `${key!.slice(0, 3)}***`,
    }));
}
