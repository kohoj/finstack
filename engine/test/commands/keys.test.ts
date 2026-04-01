// engine/test/commands/keys.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getKey, setKey, removeKey, listKeys } from '../../src/data/keys';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('keys command integration', () => {
  const TEST_DIR = join(tmpdir(), '.finstack-test-keyscmd-' + Date.now());
  const TEST_FILE = join(TEST_DIR, 'keys.json');

  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => { if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE); });

  it('set then list shows provider', () => {
    setKey('fred', 'mykey123', TEST_FILE);
    const list = listKeys(TEST_FILE);
    expect(list.length).toBe(1);
    expect(list[0].provider).toBe('fred');
    expect(list[0].masked).toBe('myk***');
  });

  it('remove then get returns null', () => {
    setKey('polygon', 'pk_123', TEST_FILE);
    removeKey('polygon', TEST_FILE);
    expect(getKey('polygon', TEST_FILE)).toBeNull();
  });
});
