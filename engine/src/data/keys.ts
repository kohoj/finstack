import { KEYS_FILE } from '../paths';
import { atomicWriteJSON, readJSONSafe } from '../fs';

type Provider = 'fred' | 'alphavantage' | 'polygon' | 'fmp';
type KeyStore = Partial<Record<Provider, string>>;

function load(file: string): KeyStore {
  return readJSONSafe<KeyStore>(file, {});
}

function save(data: KeyStore, file: string): void {
  atomicWriteJSON(file, data, 0o600);
}

export { KEYS_FILE };

export function getKey(provider: string, file = KEYS_FILE): string | null {
  return load(file)[provider as Provider] ?? null;
}

export function setKey(provider: string, key: string, file = KEYS_FILE): void {
  const data = load(file);
  data[provider as Provider] = key;
  save(data, file);
}

export function removeKey(provider: string, file = KEYS_FILE): void {
  const data = load(file);
  delete data[provider as Provider];
  save(data, file);
}

export function listKeys(file = KEYS_FILE): { provider: string; configured: boolean; masked: string }[] {
  const data = load(file);
  return Object.entries(data)
    .filter(([, v]) => v)
    .map(([provider, key]) => ({
      provider,
      configured: true,
      masked: key!.slice(0, 3) + '***',
    }));
}
