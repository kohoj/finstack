// engine/src/commands/report.ts

import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPortfolio, valuePortfolio } from '../data/portfolio';
import { FinstackError } from '../errors';
import { readJSONSafe } from '../fs';
import { paths } from '../paths';
import { barChart, pieChart } from '../report/charts';
import { renderReport } from '../report/templates';

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function openFile(path: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  // execFile, not exec: the path is passed as an argv entry, never parsed by a
  // shell. REPORTS_DIR derives from FINSTACK_HOME, so a home path containing
  // shell metacharacters would otherwise be interpreted rather than opened.
  execFile(cmd, [path], () => {}); // fire-and-forget
}

function _parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function generateSenseReport(): string {
  const portfolio = loadPortfolio();
  const valuation = valuePortfolio(portfolio);
  const watchlist = readJSONSafe<any[]>(paths.WATCHLIST_FILE, []);

  const positions = portfolio.positions;
  const sections = [];

  // Portfolio heatmap (simple table of positions)
  if (positions.length > 0) {
    const rows = positions
      .map(position => {
        const mark = valuation.positions.find(item => item.ticker === position.ticker);
        const basis = mark?.priceSource === 'mark' ? `mark · ${mark.markSource}` : 'cost fallback';
        return `<tr><td class="px-3 py-2 font-mono">${position.ticker}</td><td class="px-3 py-2">${position.shares}</td><td class="px-3 py-2">${position.currency} ${position.avgCost.toFixed(2)}</td><td class="px-3 py-2">${basis}</td></tr>`;
      })
      .join('');
    sections.push({
      title: 'Portfolio Positions',
      content: `<table class="w-full"><thead><tr><th class="px-3 py-2 text-left">Ticker</th><th class="px-3 py-2 text-left">Shares</th><th class="px-3 py-2 text-left">Avg Cost</th><th class="px-3 py-2 text-left">Valuation</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
  }

  // Watchlist
  if (watchlist.length > 0) {
    const rows = watchlist
      .map(
        (w: any) =>
          `<tr><td class="px-3 py-2 font-mono">${w.ticker}</td><td class="px-3 py-2">${w.reason}</td><td class="px-3 py-2">${w.tags?.join(', ') || ''}</td></tr>`,
      )
      .join('');
    sections.push({
      title: 'Watchlist',
      content: `<table class="w-full"><thead><tr><th class="px-3 py-2 text-left">Ticker</th><th class="px-3 py-2 text-left">Reason</th><th class="px-3 py-2 text-left">Tags</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
  }

  return renderReport({
    title: 'Signal Report',
    subtitle: 'Daily briefing overview',
    date: today(),
    sections,
  });
}

function generateTrackReport(): string {
  const portfolio = loadPortfolio();
  const valuation = valuePortfolio(portfolio);
  const shadow = readJSONSafe<any>(paths.SHADOW_FILE, { entries: [] });
  const theses = readJSONSafe<any>(paths.THESES_FILE, { theses: [] });

  const positions = valuation.positions.filter(position => position.valueBase !== null);
  const sections = [];

  // Allocation must use an explicit market mark, or a visibly labelled cost
  // fallback. Cost is accounting data, never a silently implied quote.
  if (positions.length > 0) {
    const totalValue = valuation.totalValueBase;
    const weights: { ticker: string; weight: number }[] = positions.map(position => ({
      ticker: position.ticker,
      weight: ((position.valueBase ?? 0) / totalValue) * 100,
    }));

    const colors = [
      '#ef4444',
      '#f97316',
      '#eab308',
      '#22c55e',
      '#3b82f6',
      '#8b5cf6',
      '#ec4899',
      '#06b6d4',
      '#84cc16',
      '#f43f5e',
    ];

    sections.push({
      title: 'Portfolio Allocation',
      content: `<p class="mb-3">${portfolio.baseCurrency} ${totalValue.toFixed(2)} · ${valuation.fullyMarked ? 'all positions explicitly marked' : `cost fallback: ${valuation.costFallbackTickers.join(', ') || 'none'}`}</p>${weights
        .map(
          weight =>
            `<span class="inline-block mr-4">${weight.ticker}: ${weight.weight.toFixed(1)}%</span>`,
        )
        .join('')}`,
      chart: pieChart(
        weights.map(w => w.ticker),
        weights.map(w => +w.weight.toFixed(1)),
        colors.slice(0, weights.length),
      ),
      chartId: 'allocationChart',
    });
  }

  if (valuation.unvaluedTickers.length > 0) {
    sections.push({
      title: 'Incomplete Valuation',
      content: `<p>Excluded from base-currency allocation because FX conversion is missing: ${valuation.unvaluedTickers.join(', ')}. Add a mark with its FX rate before relying on this report.</p>`,
    });
  }

  // Thesis status
  const aliveTheses = theses.theses?.filter((t: any) => t.status !== 'dead') || [];
  if (aliveTheses.length > 0) {
    const rows = aliveTheses
      .map(
        (t: any) =>
          `<tr><td class="px-3 py-2 font-mono">${t.ticker}</td><td class="px-3 py-2">${t.status}</td><td class="px-3 py-2">${t.thesis.slice(0, 60)}</td></tr>`,
      )
      .join('');
    sections.push({
      title: 'Active Theses',
      content: `<table class="w-full"><thead><tr><th class="px-3 py-2 text-left">Ticker</th><th class="px-3 py-2 text-left">Status</th><th class="px-3 py-2 text-left">Thesis</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
  }

  // Shadow positions
  const openShadow = shadow.entries?.filter((e: any) => e.status === 'open') || [];
  if (openShadow.length > 0) {
    const rows = openShadow
      .map(
        (e: any) =>
          `<tr><td class="px-3 py-2 font-mono">${e.ticker}</td><td class="px-3 py-2">${e.action}</td><td class="px-3 py-2">${e.filledShares}/${e.totalShares}</td><td class="px-3 py-2">${e.timeHorizon || '-'}</td></tr>`,
      )
      .join('');
    sections.push({
      title: 'Shadow Positions (Disciplined You)',
      content: `<table class="w-full"><thead><tr><th class="px-3 py-2 text-left">Ticker</th><th class="px-3 py-2 text-left">Action</th><th class="px-3 py-2 text-left">Filled</th><th class="px-3 py-2 text-left">Horizon</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
  }

  return renderReport({
    title: 'Portfolio Track Report',
    subtitle: `Allocation in ${portfolio.baseCurrency}; mark provenance shown where available`,
    date: today(),
    sections,
  });
}

function generateReflectReport(): string {
  const theses = readJSONSafe<any>(paths.THESES_FILE, { theses: [] });

  const sections = [];

  // Thesis outcomes summary
  const dead = theses.theses?.filter((t: any) => t.status === 'dead') || [];
  const alive = theses.theses?.filter((t: any) => t.status !== 'dead') || [];

  sections.push({
    title: 'Thesis Lifecycle',
    content: `<div class="grid grid-cols-2 gap-4">
      <div class="bg-gray-900 rounded-lg p-4"><p class="text-3xl font-bold text-green-400">${alive.length}</p><p class="text-gray-400">Active</p></div>
      <div class="bg-gray-900 rounded-lg p-4"><p class="text-3xl font-bold text-red-400">${dead.length}</p><p class="text-gray-400">Closed</p></div>
    </div>`,
  });

  if (alive.length > 0) {
    const statusCounts: Record<string, number> = {};
    for (const t of alive) {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    }
    const labels = Object.keys(statusCounts);
    const data = Object.values(statusCounts);
    const _colors = {
      alive: '#22c55e',
      threatened: '#eab308',
      critical: '#ef4444',
      reinforced: '#3b82f6',
    };

    sections.push({
      title: 'Active Thesis Status',
      content: '',
      chart: barChart(labels, [{ label: 'Count', data, color: '#3b82f6' }]),
      chartId: 'thesisStatusChart',
    });
  }

  return renderReport({
    title: 'Reflection Report',
    subtitle: 'Behavioral patterns and thesis outcomes',
    date: today(),
    sections,
  });
}

export async function report(args: string[]) {
  const type = args[0];
  const noOpen = args.includes('--no-open');

  if (!type) {
    throw new FinstackError(
      'Usage: finstack report sense|track|reflect [--no-open]',
      undefined,
      'No report type given',
      'Example: finstack report track --no-open',
    );
  }

  mkdirSync(paths.REPORTS_DIR, { recursive: true });

  let html: string;
  let filename: string;

  switch (type) {
    case 'sense':
      html = generateSenseReport();
      filename = `sense-${today()}.html`;
      break;
    case 'track':
      html = generateTrackReport();
      filename = `track-${today()}.html`;
      break;
    case 'reflect':
      html = generateReflectReport();
      filename = `reflect-${today()}.html`;
      break;
    default:
      throw new FinstackError(
        `Unknown report type: ${type}`,
        undefined,
        'Valid types are sense, track, reflect',
        'Example: finstack report track',
      );
  }

  const outPath = join(paths.REPORTS_DIR, filename);
  writeFileSync(outPath, html);

  console.log(
    JSON.stringify(
      {
        report: type,
        path: outPath,
        date: today(),
      },
      null,
      2,
    ),
  );

  if (!noOpen) {
    openFile(outPath);
  }
}
