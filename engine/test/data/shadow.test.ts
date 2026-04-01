import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), '.finstack-test-shadow-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'shadow.json');

describe('shadow', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => { if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE); });

  it('creates a shadow entry', () => {
    const { createEntry, loadShadow } = require('../../src/data/shadow');
    createEntry({
      ticker: 'NVDA',
      action: 'buy',
      entryDate: '2026-04-02',
      totalShares: 12,
      stagedPlan: [
        { tranche: 1, shares: 8, trigger: 'immediate', status: 'filled', fillPrice: 852.30, fillDate: '2026-04-02' },
        { tranche: 2, shares: 4, trigger: '5% dip', triggerPrice: 809.69, fallbackDate: '2026-05-02', status: 'pending', fillPrice: null, fillDate: null },
      ],
      stopLoss: { price: 780, reason: 'Thesis falsified' },
      takeProfit: { price: 1050, reason: 'Bull case priced in' },
      timeHorizon: '2026-10-02',
      linkedThesis: 't123',
      sourceJudge: 'judge-NVDA-2026-04-01.md',
      sourceAct: 'act-NVDA-2026-04-01.md',
    }, TEST_FILE);

    const shadow = loadShadow(TEST_FILE);
    expect(shadow.entries.length).toBe(1);
    expect(shadow.entries[0].ticker).toBe('NVDA');
    expect(shadow.entries[0].status).toBe('open');
    expect(shadow.entries[0].stagedPlan.length).toBe(2);
    expect(shadow.entries[0].filledShares).toBe(8);
    expect(shadow.entries[0].id).toBeDefined();
  });

  it('finds open entry by ticker', () => {
    const { createEntry, findOpen } = require('../../src/data/shadow');
    createEntry({
      ticker: 'AAPL', action: 'buy', entryDate: '2026-04-02', totalShares: 10,
      stagedPlan: [{ tranche: 1, shares: 10, trigger: 'immediate', status: 'filled', fillPrice: 170, fillDate: '2026-04-02' }],
      stopLoss: { price: 150, reason: 'test' }, takeProfit: { price: 200, reason: 'test' },
      timeHorizon: '2026-10-02', linkedThesis: null, sourceJudge: '', sourceAct: '',
    }, TEST_FILE);
    const entry = findOpen('AAPL', TEST_FILE);
    expect(entry).not.toBeNull();
    expect(entry!.ticker).toBe('AAPL');
  });

  it('closes an entry', () => {
    const { createEntry, closeEntry, findOpen } = require('../../src/data/shadow');
    createEntry({
      ticker: 'AAPL', action: 'buy', entryDate: '2026-04-02', totalShares: 10,
      stagedPlan: [{ tranche: 1, shares: 10, trigger: 'immediate', status: 'filled', fillPrice: 170, fillDate: '2026-04-02' }],
      stopLoss: { price: 150, reason: 'test' }, takeProfit: { price: 200, reason: 'test' },
      timeHorizon: '2026-10-02', linkedThesis: null, sourceJudge: '', sourceAct: '',
    }, TEST_FILE);
    closeEntry('AAPL', 185.50, '2026-07-01', 'time-horizon', TEST_FILE);
    const entry = findOpen('AAPL', TEST_FILE);
    expect(entry).toBeNull();
  });
});
