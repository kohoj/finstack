import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DEFAULT_KEYS_FILE = join(homedir(), '.finstack', 'keys.json');

type Provider = 'fred' | 'alphavantage' | 'polygon';
type KeyStore = Partial<Record<Provider, string>>;

function load(file: string): KeyStore {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function save(data: KeyStore, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  try { chmodSync(file, 0o600); } catch {}
}

export const KEYS_FILE = DEFAULT_KEYS_FILE;

export function getKey(provider: string, file = DEFAULT_KEYS_FILE): string | null {
  return load(file)[provider as Provider] ?? null;
}

export function setKey(provider: string, key: string, file = DEFAULT_KEYS_FILE): void {
  const data = load(file);
  data[provider as Provider] = key;
  save(data, file);
}

export function removeKey(provider: string, file = DEFAULT_KEYS_FILE): void {
  const data = load(file);
  delete data[provider as Provider];
  save(data, file);
}

export function listKeys(file = DEFAULT_KEYS_FILE): { provider: string; configured: boolean; masked: string }[] {
  const data = load(file);
  return Object.entries(data)
    .filter(([, v]) => v)
    .map(([provider, key]) => ({
      provider,
      configured: true,
      masked: key!.slice(0, 3) + '***',
    }));
}
