import { computeDrawdown, loadEquity, recordEquity } from '../data/equity';
import { loadProfile, setRiskBudget } from '../data/profile';
import { loadShadow, type ShadowEntry } from '../data/shadow';
import { FinstackError } from '../errors';
import { readJSONSafe } from '../fs';
import { paths } from '../paths';
import { validatePositiveNumber, validateStopVsEntry, validateTicker } from '../validation';

interface Position {
  ticker: string;
  shares: number;
  avgCost: number;
  addedAt: string;
}

interface Portfolio {
  positions: Position[];
  transactions: {
    ticker: string;
    action: string;
    shares: number;
    price: number;
    date: string;
    reason: string | null;
  }[];
  updatedAt: string;
}

interface PositionRisk {
  ticker: string;
  shares: number;
  avgCost: number;
  marketValue: number;
  weight: number;
  stopLoss: number | null;
  stopRiskDollars: number | null;
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
  pass: boolean;
  warnings: string[];
  blocks: string[];
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export function calculateConcentration(
  positions: { ticker: string; weight: number }[],
  limits = { single: 25, top3: 60 },
): ConcentrationReport {
  const sorted = [...positions].sort((a, b) => b.weight - a.weight);
  const top1 = sorted[0] || { ticker: '-', weight: 0 };
  const top3Tickers = sorted.slice(0, 3).map(p => p.ticker);
  const top3Weight = sorted.slice(0, 3).reduce((s, p) => s + p.weight, 0);

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
  limits = { singlePosition: 25, top3: 60, positionRisk: 5, drawdown: 15 },
): RiskGate {
  const warnings: string[] = [];
  const blocks: string[] = [];

  // Concentration check (post-trade)
  if (newWeight > limits.singlePosition) {
    blocks.push(
      `${newTicker} would be ${newWeight.toFixed(1)}% of portfolio (limit: ${limits.singlePosition}%)`,
    );
  }

  const sorted = [...positions, { ticker: newTicker, weight: newWeight }].sort(
    (a, b) => b.weight - a.weight,
  );
  const top3 = sorted.slice(0, 3).reduce((s, p) => s + p.weight, 0);
  if (top3 > limits.top3) {
    warnings.push(`Top 3 concentration would be ${top3.toFixed(1)}% (limit: ${limits.top3}%)`);
  }

  // Position risk check
  if (stopRiskPct !== null && stopRiskPct > limits.positionRisk) {
    blocks.push(
      `Position risk at stop-loss: ${stopRiskPct.toFixed(1)}% of portfolio (limit: ${limits.positionRisk}%)`,
    );
  }

  // Drawdown circuit breaker
  if (drawdownPct > limits.drawdown) {
    blocks.push(
      `Portfolio drawdown: ${drawdownPct.toFixed(1)}% (circuit breaker: ${limits.drawdown}%). Stop. Breathe. Run /reflect before trading.`,
    );
  } else if (drawdownPct > limits.drawdown * 0.7) {
    warnings.push(
      `Portfolio drawdown: ${drawdownPct.toFixed(1)}% — approaching circuit breaker (${limits.drawdown}%)`,
    );
  }

  return {
    pass: blocks.length === 0,
    warnings,
    blocks,
  };
}

function loadPortfolio(): Portfolio {
  const data = readJSONSafe<Portfolio>(paths.PORTFOLIO_FILE, {
    positions: [],
    transactions: [],
    updatedAt: '',
  });
  if (!data.transactions) data.transactions = [];
  return data as Portfolio;
}

export async function risk(args: string[]) {
  const sub = args[0];

  // Subcommand: size — position sizing calculator
  if (sub === 'size') {
    const ticker = validateTicker(args[1]);
    const entry = validatePositiveNumber(args[2], 'entry price');
    const stop = validatePositiveNumber(args[3], 'stop price');
    validateStopVsEntry(entry, stop);

    // Optional --shares N overrides budget-derived sizing with the user's
    // actual intended share count. Without it, shares are back-solved from the
    // risk budget, so stop-loss risk is always ≈ the budget and the gate's
    // positionRisk block is tautological. With an explicit count the stop risk
    // is whatever the user's size actually implies, so the block can fire.
    const sharesFlag = parseFlag(args, '--shares');
    const userShares =
      sharesFlag !== undefined ? validatePositiveNumber(sharesFlag, 'shares') : null;

    const portfolio = loadPortfolio();
    const profile = loadProfile();
    const portfolioValue = portfolio.positions.reduce((s, p) => s + p.shares * p.avgCost, 0);

    if (portfolioValue === 0) {
      throw new FinstackError(
        'Empty portfolio — cannot size a position against zero capital',
        undefined,
        'Position sizing is a percentage of total portfolio value',
        'Add positions first: finstack portfolio add <ticker> <shares> <avgCost>',
      );
    }

    const riskPerShare = Math.abs(entry - stop);
    const sizing =
      userShares !== null
        ? {
            shares: userShares,
            positionDollars: +(userShares * entry).toFixed(2),
            riskDollars: +(userShares * riskPerShare).toFixed(2),
          }
        : calculatePositionSize(portfolioValue, profile.riskBudgetPct, entry, stop);

    // Post-trade weight of the *whole* position in this ticker, not just the
    // addition. Adding to an existing holding was measured against the new
    // shares alone, so topping up a position already at 80% reported 13.8% and
    // the 25% single-position block never fired.
    const existingValue = portfolio.positions
      .filter(p => p.ticker === ticker)
      .reduce((s, p) => s + p.shares * p.avgCost, 0);

    const postTradeValue = portfolioValue + sizing.positionDollars;
    const weight =
      postTradeValue > 0 ? ((existingValue + sizing.positionDollars) / postTradeValue) * 100 : 0;

    // Other holdings only. The ticker being sized is passed separately as its
    // post-trade weight; including its pre-trade weight here would count it
    // twice in the top-3 sum.
    const existingWeights = portfolio.positions
      .filter(p => p.ticker !== ticker)
      .map(p => ({
        ticker: p.ticker,
        weight: ((p.shares * p.avgCost) / postTradeValue) * 100,
      }));
    // Real position risk at the stop: actual dollars lost if stopped out
    // (shares · |entry−stop|, already computed as sizing.riskDollars) as a
    // percentage of post-trade portfolio value. The gate's 4th argument is
    // this stop-loss risk, NOT the risk *budget*. Passing riskBudgetPct here
    // fed the gate the target (≤5, its own default budget of 2), so the
    // positionRisk block could never fire. The dashboard path below already
    // computes this correctly (stopRiskDollars / portfolioValue); size now
    // matches it.
    const stopRiskPct = postTradeValue > 0 ? (sizing.riskDollars / postTradeValue) * 100 : 0;
    const gate = evaluateRiskGate(ticker, weight, existingWeights, stopRiskPct, 0);

    console.log(
      JSON.stringify(
        {
          ticker,
          entry,
          stop,
          riskPerShare: +Math.abs(entry - stop).toFixed(2),
          sizing: {
            shares: sizing.shares,
            positionDollars: sizing.positionDollars,
            riskDollars: sizing.riskDollars,
            riskBudgetPct: profile.riskBudgetPct,
            sizingMode: userShares !== null ? 'user-shares' : 'risk-budget',
            // Weight of the combined position after the trade. When adding to
            // an existing holding this exceeds the new tranche's own share.
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

  // Subcommand: snapshot — record a mark-to-market equity value.
  //
  // The engine has no live prices, so the caller (skills layer, via $F quote)
  // supplies the current portfolio value. This feeds the equity curve that the
  // drawdown circuit breaker reads.
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

  // Subcommand: profile — view or set the risk profile.
  //
  // `risk profile` prints the current budget; `risk profile --risk-budget N`
  // sets it. This is the only writer for profile.json — without it
  // riskBudgetPct was pinned to its default with no way to change it.
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

  // Default: portfolio risk dashboard
  const portfolio = loadPortfolio();
  const shadow = loadShadow();
  const profile = loadProfile();

  if (portfolio.positions.length === 0) {
    console.log(
      JSON.stringify(
        {
          message:
            'Empty portfolio. Add positions first: finstack portfolio add <ticker> <shares> <avgCost>',
        },
        null,
        2,
      ),
    );
    return;
  }

  // Calculate portfolio value using avgCost (no live prices in engine — skills use $F quote)
  const portfolioValue = portfolio.positions.reduce((s, p) => s + p.shares * p.avgCost, 0);

  // Build position risks
  const positionRisks: PositionRisk[] = portfolio.positions.map(pos => {
    const marketValue = pos.shares * pos.avgCost;
    const weight = (marketValue / portfolioValue) * 100;

    // Find stop-loss from shadow entry
    const shadowEntry = shadow.entries.find(
      (e: ShadowEntry) => e.ticker === pos.ticker && e.status === 'open',
    );
    const stopLoss = shadowEntry?.stopLoss?.price || null;
    const stopRiskDollars = stopLoss !== null ? (pos.avgCost - stopLoss) * pos.shares : null;
    const stopRiskPct = stopRiskDollars !== null ? (stopRiskDollars / portfolioValue) * 100 : null;

    return {
      ticker: pos.ticker,
      shares: pos.shares,
      avgCost: pos.avgCost,
      marketValue: +marketValue.toFixed(2),
      weight: +weight.toFixed(1),
      stopLoss,
      stopRiskDollars: stopRiskDollars !== null ? +stopRiskDollars.toFixed(2) : null,
      stopRiskPct: stopRiskPct !== null ? +stopRiskPct.toFixed(1) : null,
      unrealizedPL: 0,
      unrealizedPLPct: 0,
    };
  });

  // Concentration
  const concentration = calculateConcentration(
    positionRisks.map(p => ({ ticker: p.ticker, weight: p.weight })),
  );

  // Positions without stop-loss
  const noStop = positionRisks.filter(p => p.stopLoss === null);

  // Positions over risk budget
  const overBudget = positionRisks.filter(
    p => p.stopRiskPct !== null && p.stopRiskPct > profile.riskBudgetPct * 2.5,
  );

  // Risk budget
  const riskBudgetDollars = portfolioValue * (profile.riskBudgetPct / 100);

  // Drawdown circuit breaker. The engine has no live prices, so drawdown is
  // read purely from the recorded equity curve, which the skills layer feeds
  // with real marks via `risk snapshot <value>` (value from $F quote).
  // Cost-basis portfolioValue is deliberately NOT injected here: it does not
  // move with the market, so it can never express a drawdown and would only
  // overwrite a real same-day mark. drawdownPct is 0 until the curve holds a
  // peak above its latest value.
  const equity = loadEquity();
  const dd = computeDrawdown(equity);
  const DRAWDOWN_LIMIT = 15;
  const drawdownAlert =
    dd.drawdownPct > DRAWDOWN_LIMIT
      ? `Portfolio drawdown ${dd.drawdownPct.toFixed(1)}% exceeds circuit breaker (${DRAWDOWN_LIMIT}%). Stop. Breathe. Run /reflect before trading.`
      : dd.drawdownPct > DRAWDOWN_LIMIT * 0.7
        ? `Portfolio drawdown ${dd.drawdownPct.toFixed(1)}% approaching circuit breaker (${DRAWDOWN_LIMIT}%)`
        : null;

  const output = {
    portfolioValue: +portfolioValue.toFixed(2),
    positions: positionRisks.length,
    riskBudget: {
      pct: profile.riskBudgetPct,
      maxLossPerTrade: +riskBudgetDollars.toFixed(2),
    },
    drawdown: {
      peak: dd.peak,
      peakDate: dd.peakDate,
      current: dd.current,
      drawdownPct: dd.drawdownPct,
      circuitBreakerPct: DRAWDOWN_LIMIT,
      tripped: dd.drawdownPct > DRAWDOWN_LIMIT,
      hasHistory: equity.snapshots.length > 0,
    },
    concentration,
    positionRisks: positionRisks.sort((a, b) => b.weight - a.weight),
    alerts: {
      noStopLoss: noStop.map(p => p.ticker),
      overRiskBudget: overBudget.map(p => ({
        ticker: p.ticker,
        riskPct: p.stopRiskPct,
      })),
      concentrationWarnings: concentration.warnings,
      ...(drawdownAlert ? { drawdown: drawdownAlert } : {}),
    },
  };

  console.log(JSON.stringify(output, null, 2));
}
