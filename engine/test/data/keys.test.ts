// engine/test/data/keys.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getKey, setKey, removeKey, listKeys } from '../../src/data/keys';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), '.finstack-test-keys-' + Date.now());
const TEST_KEYS_FILE = join(TEST_DIR, 'keys.json');

describe('keys', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_KEYS_FILE)) unlinkSync(TEST_KEYS_FILE);
  });

  it('returns null for missing key', () => {
    expect(getKey('fred', TEST_KEYS_FILE)).toBeNull();
  });

  it('sets and gets a key', () => {
    setKey('fred', 'abc123', TEST_KEYS_FILE);
    expect(getKey('fred', TEST_KEYS_FILE)).toBe('abc123');
  });

  it('removes a key', () => {
    setKey('fred', 'abc123', TEST_KEYS_FILE);
    removeKey('fred', TEST_KEYS_FILE);
    expect(getKey('fred', TEST_KEYS_FILE)).toBeNull();
  });

  it('lists configured providers', () => {
    setKey('fred', 'abc123', TEST_KEYS_FILE);
    setKey('polygon', 'xyz789', TEST_KEYS_FILE);
    const list = listKeys(TEST_KEYS_FILE);
    expect(list).toEqual([
      { provider: 'fred', configured: true, masked: 'abc***' },
      { provider: 'polygon', configured: true, masked: 'xyz***' },
    ]);
  });

  it('sets file permissions to 0600', () => {
    setKey('fred', 'abc123', TEST_KEYS_FILE);
    expect(existsSync(TEST_KEYS_FILE)).toBe(true);
  });
});
