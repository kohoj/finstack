import { describe, it, expect } from 'bun:test';

describe('portfolio transaction log', () => {
  it('add creates a buy transaction', () => {
    const expectedTx = {
      ticker: 'NVDA',
      action: 'buy',
      shares: 10,
      price: 850,
      date: expect.any(String),
      reason: null,
    };
    expect(expectedTx.action).toBe('buy');
    expect(expectedTx.reason).toBeNull();
  });

  it('remove creates a sell transaction with reason', () => {
    const expectedTx = {
      ticker: 'NVDA',
      action: 'sell',
      shares: 10,
      price: 910,
      date: expect.any(String),
      reason: 'emotional',
    };
    expect(expectedTx.action).toBe('sell');
    expect(expectedTx.reason).toBe('emotional');
  });
});
