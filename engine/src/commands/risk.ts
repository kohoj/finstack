import { computeDrawdown, loadEquity, recordEquity } from '../data/equity';
import {
  loadPortfolio,
  normalizeCurrency,
  type ValuedPosition,
  valuePortfolio,
} from '../data/portfolio';
import { loadProfile, setRiskBudget } from '../data/profile';
import { oldestMarkAgeDays, RISK_POLICY } from '../data/risk-policy';
import { loadShadow, type ShadowEntry } from '../data/shadow';
import { FinstackError } from '../errors';
import { validatePositiveNumber, validateStopVsEntry, validateTicker } from '../validation';

interface PositionRisk {
  ticker: string;
  shares: number;
  currency: string;
  avgCost: number;
  markPrice: number;
  markSource: string | null;
  markedAt: string | null;
  valuationBasis: 'mark' | 'cost';
  marketValue: number;
  marketValueBase: number;
  weight: number;
  stopLoss: number | null;
  stopRiskNative: number | null;
  stopRiskBase: number | null;
  stopRiskPct: number | null;
  unrealizedPL: number;
  unrealizedPLPct: number;
}

interface ConcentrationReport {
  top1: { ticker: string; weight: number };
  top3: { tickers: string[]; weight: number };
  warnings: string[];
}

interface RiskGate {
  /** `pass` means no block and no unresolved acknowledgement. */
  pass: boolean;
  status: 'pass' | 'requires_acknowledgement' | 'blocked';
  warnings: string[];
  acknowledgements: string[];
  blocks: string[];
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export function calculateConcentration(
  positions: { ticker: string; weight: number }[],
  limits = {
    single: RISK_POLICY.concentration.singlePositionPct,
    top3: RISK_POLICY.concentration.topThreePct,
  },
): ConcentrationReport {
  const sorted = [...positions].sort((a, b) => b.weight - a.weight);
  const top1 = sorted[0] || { ticker: '-', weight: 0 };
  const top3Tickers = sorted.slice(0, 3).map(p => p.ticker);
  const top3Weight = sorted.slice(0, 3).reduce((sum, position) => sum + position.weight, 0);

  const warnings: string[] = [];
  if (top1.weight > limits.single) {
    warnings.push(
      `${top1.ticker} is ${top1.weight.toFixed(1)}% of portfolio (limit: ${limits.single}%)`,
    );
  }
  if (top3Weight > limits.top3) {
    warnings.push(
      `Top 3 positions are ${top3Weight.toFixed(1)}% of portfolio (limit: ${limits.top3}%)`,
    );
  }

  return {
    top1: { ticker: top1.ticker, weight: +top1.weight.toFixed(1) },
    top3: { tickers: top3Tickers, weight: +top3Weight.toFixed(1) },
    warnings,
  };
}

export function calculatePositionSize(
  portfolioValue: number,
  riskBudgetPct: number,
  entryPrice: number,
  stopPrice: number,
): { shares: number; positionDollars: number; riskDollars: number } {
  const riskDollars = portfolioValue * (riskBudgetPct / 100);
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  if (riskPerShare <= 0) return { shares: 0, positionDollars: 0, riskDollars };
  const shares = Math.floor(riskDollars / riskPerShare);
  return {
    shares,
    positionDollars: +(shares * entryPrice).toFixed(2),
    riskDollars: +riskDollars.toFixed(2),
  };
}

export function evaluateRiskGate(
  newTicker: string,
  newWeight: number,
  positions: { ticker: string; weight: number }[],
  stopRiskPct: number | null,
  drawdownPct: number,
  limits = {
    singlePosition: RISK_POLICY.concentration.singlePositionPct,
    top3: RISK_POLICY.concentration.topThreePct,
    positionRisk: RISK_POLICY.maxPositionRiskPct,
    drawdown: RISK_POLICY.circuitBreakerPct,
  },
  context: { oldestMarkAgeDays?: number | null; costFallbackTickers?: string[] } = {},
): RiskGate {
  const warnings: string[] = [];
  const acknowledgements: string[] = [];
  const blocks: string[] = [];

  if (newWeight > limits.singlePosition) {
    blocks.push(
      `${newTicker} would be ${newWeight.toFixed(1)}% of portfolio (limit: ${limits.singlePosition}%)`,
    );
  }

  const sorted = [...positions, { ticker: newTicker, weight: newWeight }].sort(
    (a, b) => b.weight - a.weight,
  );
  const top3 = sorted.slice(0, 3).reduce((sum, position) => sum + position.weight, 0);
  if (top3 > limits.top3) {
    acknowledgements.push(
      `Top 3 concentration would be ${top3.toFixed(1)}% (limit: ${limits.top3}%). Explicit acknowledgement is required before this ticket can proceed.`,
    );
  }

  if (stopRiskPct !== null && stopRiskPct > limits.positionRisk) {
    blocks.push(
      `Position risk at stop-loss: ${stopRiskPct.toFixed(1)}% of portfolio (limit: ${limits.positionRisk}%)`,
    );
  }

  if (drawdownPct > limits.drawdown) {
    blocks.push(
      `Portfolio drawdown: ${drawdownPct.toFixed(1)}% (circuit breaker: ${limits.drawdown}%). Stop. Breathe. Run /reflect before trading.`,
    );
  } else if (drawdownPct > limits.drawdown * 0.7) {
    warnings.push(
      `Portfolio drawdown: ${drawdownPct.toFixed(1)}% — approaching circuit breaker (${limits.drawdown}%)`,
    );
  }

  if (
    context.oldestMarkAgeDays !== undefined &&
    context.oldestMarkAgeDays !== null &&
    context.oldestMarkAgeDays > RISK_POLICY.markFreshnessDays
  ) {
    acknowledgements.push(
      `Oldest portfolio mark is ${context.oldestMarkAgeDays} days old (review threshold: ${RISK_POLICY.markFreshnessDays} day). Refresh or explicitly acknowledge the dated valuation before this ticket can proceed.`,
    );
  }

  if (context.costFallbackTickers?.length) {
    acknowledgements.push(
      `Portfolio values for ${context.costFallbackTickers.join(', ')} use historical cost, not an explicit market mark. Refresh or explicitly acknowledge this valuation before this ticket can proceed.`,
    );
  }

  const status =
    blocks.length > 0
      ? 'blocked'
      : acknowledgements.length > 0
        ? 'requires_acknowledgement'
        : 'pass';
  return { pass: status === 'pass', status, warnings, acknowledgements, blocks };
}

function requireValuedPortfolio() {
  const portfolio = loadPortfolio();
  const valuation = valuePortfolio(portfolio);
  if (valuation.unvaluedTickers.length > 0) {
    throw new FinstackError(
      'Portfolio valuation is incomplete',
      undefined,
      `Missing base-currency conversion for: ${valuation.unvaluedTickers.join(', ')}`,
      'Mark foreign-currency positions with --fx-rate before sizing a trade.',
    );
  }
  return { portfolio, valuation };
}

function valueByTicker(positions: ValuedPosition[], ticker: string): number {
  return positions
    .filter(position => position.ticker === ticker)
    .reduce((sum, position) => sum + (position.valueBase ?? 0), 0);
}

export async function risk(args: string[]) {
  const sub = args[0];

  if (sub === 'size') {
    const ticker = validateTicker(args[1]);
    const entry = validatePositiveNumber(args[2], 'entry price');
    const stop = validatePositiveNumber(args[3], 'stop price');
    validateStopVsEntry(entry, stop);
    const sharesFlag = parseFlag(args, '--shares');
    const userShares =
      sharesFlag !== undefined ? validatePositiveNumber(sharesFlag, 'shares') : null;

    const { portfolio, valuation } = requireValuedPortfolio();
    const profile = loadProfile();
    const portfolioValue = valuation.totalValueBase;
    if (portfolioValue === 0) {
      throw new FinstackError(
        'Empty portfolio — cannot size a position against zero capital',
        undefined,
        'Position sizing is a percentage of total portfolio value',
        'Import a portfolio snapshot or add positions first.',
      );
    }

    const currency = normalizeCurrency(
      parseFlag(args, '--currency') || portfolio.baseCurrency,
      'currency',
    );
    const fxRateToBase =
      currency === portfolio.baseCurrency
        ? 1
        : validatePositiveNumber(
            parseFlag(args, '--fx-rate'),
            `FX rate (${portfolio.baseCurrency} per ${currency})`,
          );
    const entryBase = entry * fxRateToBase;
    const stopBase = stop * fxRateToBase;
    const riskPerShareBase = Math.abs(entryBase - stopBase);
    const sizing =
      userShares !== null
        ? {
            shares: userShares,
            positionDollars: +(userShares * entryBase).toFixed(2),
            riskDollars: +(userShares * riskPerShareBase).toFixed(2),
          }
        : calculatePositionSize(portfolioValue, profile.riskBudgetPct, entryBase, stopBase);

    const existingValue = valueByTicker(valuation.positions, ticker);
    const postTradeValue = portfolioValue + sizing.positionDollars;
    const weight =
      postTradeValue > 0 ? ((existingValue + sizing.positionDollars) / postTradeValue) * 100 : 0;
    const existingWeights = valuation.positions
      .filter(position => position.ticker !== ticker)
      .map(position => ({
        ticker: position.ticker,
        weight: ((position.valueBase ?? 0) / postTradeValue) * 100,
      }));
    const stopRiskPct = postTradeValue > 0 ? (sizing.riskDollars / postTradeValue) * 100 : 0;
    const oldestAgeDays = oldestMarkAgeDays(valuation.positions.map(position => position.markedAt));
    const gate = evaluateRiskGate(ticker, weight, existingWeights, stopRiskPct, 0, undefined, {
      oldestMarkAgeDays: oldestAgeDays,
      costFallbackTickers: valuation.costFallbackTickers,
    });

    console.log(
      JSON.stringify(
        {
          ticker,
          entry,
          stop,
          currency,
          baseCurrency: portfolio.baseCurrency,
          fxRateToBase,
          entryBase: +entryBase.toFixed(4),
          stopBase: +stopBase.toFixed(4),
          riskPerShare: +Math.abs(entry - stop).toFixed(4),
          riskPerShareBase: +riskPerShareBase.toFixed(4),
          valuation: {
            fullyMarked: valuation.fullyMarked,
            costFallbackTickers: valuation.costFallbackTickers,
          },
          markFreshness: {
            oldestAgeDays,
            reviewThresholdDays: RISK_POLICY.markFreshnessDays,
          },
          sizing: {
            shares: sizing.shares,
            positionDollars: sizing.positionDollars,
            riskDollars: sizing.riskDollars,
            riskBudgetPct: profile.riskBudgetPct,
            sizingMode: userShares !== null ? 'user-shares' : 'risk-budget',
            weightPct: +weight.toFixed(1),
            ...(existingValue > 0
              ? { addingToExisting: true, existingValue: +existingValue.toFixed(2) }
              : {}),
          },
          riskGate: gate,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (sub === 'snapshot') {
    const value = validatePositiveNumber(args[1], 'portfolio value');
    const isoDate = new Date().toISOString().split('T')[0];
    const history = recordEquity(value, isoDate);
    const dd = computeDrawdown(history);
    console.log(
      JSON.stringify(
        {
          recorded: { date: isoDate, value },
          snapshots: history.snapshots.length,
          peak: dd.peak,
          peakDate: dd.peakDate,
          drawdownPct: dd.drawdownPct,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (sub === 'profile') {
    const budgetFlag = parseFlag(args, '--risk-budget');
    if (budgetFlag !== undefined) {
      const pct = validatePositiveNumber(budgetFlag, 'risk budget');
      const updated = setRiskBudget(pct);
      console.log(
        JSON.stringify(
          { riskBudgetPct: updated.riskBudgetPct, updatedAt: updated.updatedAt },
          null,
          2,
        ),
      );
      return;
    }
    const profile = loadProfile();
    console.log(
      JSON.stringify(
        { riskBudgetPct: profile.riskBudgetPct, updatedAt: profile.updatedAt || null },
        null,
        2,
      ),
    );
    return;
  }

  const { portfolio, valuation } = requireValuedPortfolio();
  const shadow = loadShadow();
  const profile = loadProfile();
  if (portfolio.positions.length === 0) {
    console.log(
      JSON.stringify(
        { message: 'Empty portfolio. Import a portfolio snapshot or add positions first.' },
        null,
        2,
      ),
    );
    return;
  }

  const portfolioValue = valuation.totalValueBase;
  const positionRisks: PositionRisk[] = valuation.positions.map(valuationPosition => {
    const position = portfolio.positions.find(item => item.ticker === valuationPosition.ticker);
    if (!position || valuationPosition.valueBase === null) {
      throw new FinstackError('Portfolio state changed during risk calculation');
    }
    const marketValueBase = valuationPosition.valueBase;
    const weight = portfolioValue > 0 ? (marketValueBase / portfolioValue) * 100 : 0;
    const shadowEntry = shadow.entries.find(
      (entry: ShadowEntry) => entry.ticker === position.ticker && entry.status === 'open',
    );
    const stopLoss = shadowEntry?.stopLoss?.price || null;
    const stopRiskNative =
      stopLoss === null ? null : Math.max(0, valuationPosition.price - stopLoss) * position.shares;
    const stopRiskBase =
      stopRiskNative === null ? null : stopRiskNative * (valuationPosition.fxRateToBase ?? 1);
    const stopRiskPct =
      stopRiskBase === null || portfolioValue === 0 ? null : (stopRiskBase / portfolioValue) * 100;
    const unrealizedPL = (valuationPosition.price - position.avgCost) * position.shares;

    return {
      ticker: position.ticker,
      shares: position.shares,
      currency: position.currency,
      avgCost: position.avgCost,
      markPrice: valuationPosition.price,
      markSource: valuationPosition.markSource,
      markedAt: valuationPosition.markedAt,
      valuationBasis: valuationPosition.priceSource,
      marketValue: valuationPosition.nativeValue,
      marketValueBase,
      weight: +weight.toFixed(1),
      stopLoss,
      stopRiskNative: stopRiskNative === null ? null : +stopRiskNative.toFixed(2),
      stopRiskBase: stopRiskBase === null ? null : +stopRiskBase.toFixed(2),
      stopRiskPct: stopRiskPct === null ? null : +stopRiskPct.toFixed(1),
      unrealizedPL: +unrealizedPL.toFixed(2),
      unrealizedPLPct: +((valuationPosition.price / position.avgCost - 1) * 100).toFixed(2),
    };
  });

  const concentration = calculateConcentration(
    positionRisks.map(position => ({ ticker: position.ticker, weight: position.weight })),
  );
  const noStop = positionRisks.filter(position => position.stopLoss === null);
  const overBudget = positionRisks.filter(
    position => position.stopRiskPct !== null && position.stopRiskPct > profile.riskBudgetPct * 2.5,
  );
  const riskBudgetDollars = portfolioValue * (profile.riskBudgetPct / 100);
  const equity = loadEquity();
  const dd = computeDrawdown(equity);
  const drawdownLimit = RISK_POLICY.circuitBreakerPct;
  const oldestAgeDays = oldestMarkAgeDays(valuation.positions.map(position => position.markedAt));
  const drawdownAlert =
    dd.drawdownPct > drawdownLimit
      ? `Portfolio drawdown ${dd.drawdownPct.toFixed(1)}% exceeds circuit breaker (${drawdownLimit}%). Stop. Breathe. Run /reflect before trading.`
      : dd.drawdownPct > drawdownLimit * 0.7
        ? `Portfolio drawdown ${dd.drawdownPct.toFixed(1)}% approaching circuit breaker (${drawdownLimit}%)`
        : null;

  console.log(
    JSON.stringify(
      {
        portfolioValue: +portfolioValue.toFixed(2),
        baseCurrency: portfolio.baseCurrency,
        positions: positionRisks.length,
        valuation: {
          fullyMarked: valuation.fullyMarked,
          costFallbackTickers: valuation.costFallbackTickers,
          unvaluedTickers: valuation.unvaluedTickers,
        },
        markFreshness: {
          oldestAgeDays,
          reviewThresholdDays: RISK_POLICY.markFreshnessDays,
          requiresReview: oldestAgeDays !== null && oldestAgeDays > RISK_POLICY.markFreshnessDays,
        },
        riskBudget: { pct: profile.riskBudgetPct, maxLossPerTrade: +riskBudgetDollars.toFixed(2) },
        drawdown: {
          peak: dd.peak,
          peakDate: dd.peakDate,
          current: dd.current,
          drawdownPct: dd.drawdownPct,
          circuitBreakerPct: drawdownLimit,
          tripped: dd.drawdownPct > drawdownLimit,
          hasHistory: equity.snapshots.length > 0,
        },
        concentration,
        positionRisks: positionRisks.sort((a, b) => b.weight - a.weight),
        alerts: {
          noStopLoss: noStop.map(position => position.ticker),
          overRiskBudget: overBudget.map(position => ({
            ticker: position.ticker,
            riskPct: position.stopRiskPct,
          })),
          concentrationWarnings: concentration.warnings,
          ...(valuation.costFallbackTickers.length > 0
            ? {
                staleValuation: `Cost-basis fallback for: ${valuation.costFallbackTickers.join(', ')}. Record a mark before relying on this risk view.`,
              }
            : {}),
          ...(drawdownAlert ? { drawdown: drawdownAlert } : {}),
        },
      },
      null,
      2,
    ),
  );
}
