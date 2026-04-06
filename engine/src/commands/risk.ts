import { loadShadow, type ShadowEntry } from '../data/shadow';
import { PORTFOLIO_FILE, PROFILE_FILE } from '../paths';
import { readJSONSafe } from '../fs';

interface Position {
  ticker: string;
  shares: number;
  avgCost: number;
  addedAt: string;
}

interface Portfolio {
  positions: Position[];
  transactions: { ticker: string; action: string; shares: number; price: number; date: string; reason: string | null }[];
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
    warnings.push(`${top1.ticker} is ${top1.weight.toFixed(1)}% of portfolio (limit: ${limits.single}%)`);
  }
  if (top3Weight > limits.top3) {
    warnings.push(`Top 3 positions are ${top3Weight.toFixed(1)}% of portfolio (limit: ${limits.top3}%)`);
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
    blocks.push(`${newTicker} would be ${newWeight.toFixed(1)}% of portfolio (limit: ${limits.singlePosition}%)`);
  }

  const sorted = [...positions, { ticker: newTicker, weight: newWeight }]
    .sort((a, b) => b.weight - a.weight);
  const top3 = sorted.slice(0, 3).reduce((s, p) => s + p.weight, 0);
  if (top3 > limits.top3) {
    warnings.push(`Top 3 concentration would be ${top3.toFixed(1)}% (limit: ${limits.top3}%)`);
  }

  // Position risk check
  if (stopRiskPct !== null && stopRiskPct > limits.positionRisk) {
    blocks.push(`Position risk at stop-loss: ${stopRiskPct.toFixed(1)}% of portfolio (limit: ${limits.positionRisk}%)`);
  }

  // Drawdown circuit breaker
  if (drawdownPct > limits.drawdown) {
    blocks.push(`Portfolio drawdown: ${drawdownPct.toFixed(1)}% (circuit breaker: ${limits.drawdown}%). Stop. Breathe. Run /reflect before trading.`);
  } else if (drawdownPct > limits.drawdown * 0.7) {
    warnings.push(`Portfolio drawdown: ${drawdownPct.toFixed(1)}% — approaching circuit breaker (${limits.drawdown}%)`);
  }

  return {
    pass: blocks.length === 0,
    warnings,
    blocks,
  };
}

function loadPortfolio(): Portfolio {
  const data = readJSONSafe<Portfolio>(PORTFOLIO_FILE, {
    positions: [],
    transactions: [],
    updatedAt: ''
  });
  if (!data.transactions) data.transactions = [];
  return data as Portfolio;
}

function loadProfile(): { riskBudgetPct: number } {
  const data = readJSONSafe<any>(PROFILE_FILE, { riskBudgetPct: 2 });
  return { riskBudgetPct: data.riskBudgetPct || 2 };
}

export async function risk(args: string[]) {
  const sub = args[0];

  // Subcommand: size — position sizing calculator
  if (sub === 'size') {
    const ticker = args[1]?.toUpperCase();
    const entryStr = args[2];
    const stopStr = args[3];
    if (!ticker || !entryStr || !stopStr) {
      console.error(JSON.stringify({ error: 'Usage: finstack risk size <ticker> <entry_price> <stop_price>' }));
      process.exit(1);
    }
    const entry = parseFloat(entryStr);
    const stop = parseFloat(stopStr);
    if (entry <= 0 || stop <= 0) {
      console.error(JSON.stringify({ error: 'Prices must be positive' }));
      process.exit(1);
    }
    if (stop >= entry) {
      console.error(JSON.stringify({ error: `Stop price ($${stop}) must be below entry price ($${entry}) for a long position` }));
      process.exit(1);
    }
    const portfolio = loadPortfolio();
    const profile = loadProfile();
    const portfolioValue = portfolio.positions.reduce((s, p) => s + p.shares * p.avgCost, 0);

    if (portfolioValue === 0) {
      console.error(JSON.stringify({ error: 'Empty portfolio. Add positions first: finstack portfolio add <ticker> <shares> <avgCost>' }));
      process.exit(1);
    }

    const sizing = calculatePositionSize(portfolioValue, profile.riskBudgetPct, entry, stop);
    const weight = portfolioValue > 0 ? (sizing.positionDollars / (portfolioValue + sizing.positionDollars)) * 100 : 0;

    // Run risk gate
    const existingWeights = portfolio.positions.map(p => ({
      ticker: p.ticker,
      weight: (p.shares * p.avgCost / portfolioValue) * 100,
    }));
    const gate = evaluateRiskGate(ticker, weight, existingWeights, profile.riskBudgetPct, 0);

    console.log(JSON.stringify({
      ticker,
      entry,
      stop,
      riskPerShare: +(Math.abs(entry - stop)).toFixed(2),
      sizing: {
        shares: sizing.shares,
        positionDollars: sizing.positionDollars,
        riskDollars: sizing.riskDollars,
        riskBudgetPct: profile.riskBudgetPct,
        weightPct: +weight.toFixed(1),
      },
      riskGate: gate,
    }, null, 2));
    return;
  }

  // Default: portfolio risk dashboard
  const portfolio = loadPortfolio();
  const shadow = loadShadow();
  const profile = loadProfile();

  if (portfolio.positions.length === 0) {
    console.log(JSON.stringify({
      message: 'Empty portfolio. Add positions first: finstack portfolio add <ticker> <shares> <avgCost>',
    }, null, 2));
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

  const output = {
    portfolioValue: +portfolioValue.toFixed(2),
    positions: positionRisks.length,
    riskBudget: {
      pct: profile.riskBudgetPct,
      maxLossPerTrade: +riskBudgetDollars.toFixed(2),
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
    },
  };

  console.log(JSON.stringify(output, null, 2));
}
