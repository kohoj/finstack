import { describe, it, expect } from 'bun:test';
import { buildBacktestResult } from '../../src/commands/backtest';

const mockThesis = {
  id: 't1',
  ticker: 'NVDA',
  thesis: 'AI capex growth continues',
  verdict: 'buy',
  status: 'dead' as const,
  conditions: [
    { id: 'c1', description: 'Q2 gross margin > 60%', type: 'earnings' as const, metric: 'grossMargin', operator: '>' as const, threshold: 0.6, resolveBy: '2026-07-23', status: 'passed' as const, actualValue: 0.65, resolvedAt: '2026-07-23' },
    { id: 'c2', description: 'No capex cuts', type: 'event' as const, falsificationTest: 'Will NVDA cut capex?', watchTickers: ['NVDA'], status: 'pending' as const, threats: [] },
  ],
  statusHistory: [
    { date: '2026-01-01T00:00:00Z', from: null, to: 'alive' as const, reason: 'Registered' },
    { date: '2026-04-01T00:00:00Z', from: 'alive' as const, to: 'dead' as const, reason: 'Killed by user' },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  lastChecked: '2026-04-01T00:00:00Z',
  obituaryDueDate: '2026-07-01',
};

const mockShadow = {
  id: 's1',
  ticker: 'NVDA',
  action: 'buy',
  entryDate: '2026-01-02',
  totalShares: 100,
  filledShares: 100,
  stagedPlan: [{ tranche: 1, shares: 100, trigger: 'immediate', status: 'filled' as const, fillPrice: 800, fillDate: '2026-01-02' }],
  stopLoss: { price: 700, reason: 'thesis break' },
  takeProfit: { price: 1000, reason: 'target' },
  timeHorizon: '2026-07-01',
  linkedThesis: 't1',
  sourceJudge: 'j1',
  sourceAct: 'a1',
  createdAt: '2026-01-02T00:00:00Z',
  status: 'closed' as const,
  exitPrice: 900,
  exitDate: '2026-04-01',
  exitReason: 'thesis killed',
};

describe('buildBacktestResult', () => {
  it('calculates return percentage correctly', () => {
    const result = buildBacktestResult(mockThesis as any, mockShadow as any, null, null);
    expect(result.entryPrice).toBe(800);
    expect(result.exitPrice).toBe(900);
    expect(result.returnPct).toBe(12.5); // (900-800)/800 * 100
  });

  it('calculates holding period', () => {
    const result = buildBacktestResult(mockThesis as any, mockShadow as any, null, null);
    expect(result.holdingPeriod).toBe(90); // Jan 1 to Apr 1 = 90 days
  });

  it('evaluates condition results', () => {
    const result = buildBacktestResult(mockThesis as any, mockShadow as any, null, null);
    expect(result.conditionResults).toHaveLength(2);
    expect(result.conditionResults[0].met).toBe(true);
    expect(result.conditionResults[1].met).toBeNull(); // still pending
  });

  it('checks plan adherence', () => {
    const result = buildBacktestResult(mockThesis as any, mockShadow as any, null, null);
    expect(result.followedPlan).toBe(true); // 100/100 filled
  });

  it('handles missing shadow entry', () => {
    const result = buildBacktestResult(mockThesis as any, null, 850, null);
    expect(result.entryPrice).toBeNull();
    expect(result.followedPlan).toBeNull();
  });

  it('calculates alpha vs SPY', () => {
    const result = buildBacktestResult(mockThesis as any, mockShadow as any, null, 8.5);
    expect(result.alpha).toBe(4.0); // 12.5 - 8.5
  });
});
