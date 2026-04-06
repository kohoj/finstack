// engine/src/commands/report.ts
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { REPORTS_DIR, PORTFOLIO_FILE, SHADOW_FILE, THESES_FILE, WATCHLIST_FILE } from '../paths';
import { atomicWriteJSON, readJSONSafe } from '../fs';
import { writeFileSync } from 'fs';
import { renderReport } from '../report/templates';
import { lineChart, barChart, pieChart } from '../report/charts';
import { exec } from 'child_process';

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function openFile(path: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${cmd} "${path}"`, () => {}); // fire-and-forget
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function generateSenseReport(): string {
  const portfolio = readJSONSafe<any>(PORTFOLIO_FILE, { positions: [] });
  const watchlist = readJSONSafe<any[]>(WATCHLIST_FILE, []);

  const positions = portfolio.positions || [];
  const sections = [];

  // Portfolio heatmap (simple table of positions)
  if (positions.length > 0) {
    const rows = positions.map((p: any) =>
      `<tr><td class="px-3 py-2 font-mono">${p.ticker}</td><td class="px-3 py-2">${p.shares}</td><td class="px-3 py-2">$${p.avgCost.toFixed(2)}</td></tr>`
    ).join('');
    sections.push({
      title: 'Portfolio Positions',
      content: `<table class="w-full"><thead><tr><th class="px-3 py-2 text-left">Ticker</th><th class="px-3 py-2 text-left">Shares</th><th class="px-3 py-2 text-left">Avg Cost</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
  }

  // Watchlist
  if (watchlist.length > 0) {
    const rows = watchlist.map((w: any) =>
      `<tr><td class="px-3 py-2 font-mono">${w.ticker}</td><td class="px-3 py-2">${w.reason}</td><td class="px-3 py-2">${w.tags?.join(', ') || ''}</td></tr>`
    ).join('');
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
  const portfolio = readJSONSafe<any>(PORTFOLIO_FILE, { positions: [] });
  const shadow = readJSONSafe<any>(SHADOW_FILE, { entries: [] });
  const theses = readJSONSafe<any>(THESES_FILE, { theses: [] });

  const positions = portfolio.positions || [];
  const sections = [];

  // Sector weight pie chart (by avgCost * shares)
  if (positions.length > 0) {
    const totalValue = positions.reduce((s: number, p: any) => s + p.shares * p.avgCost, 0);
    const weights = positions.map((p: any) => ({
      ticker: p.ticker,
      weight: (p.shares * p.avgCost / totalValue * 100),
    }));

    const colors = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f43f5e'];

    sections.push({
      title: 'Portfolio Allocation',
      content: weights.map(w => `<span class="inline-block mr-4">${w.ticker}: ${w.weight.toFixed(1)}%</span>`).join(''),
      chart: pieChart(
        weights.map(w => w.ticker),
        weights.map(w => +w.weight.toFixed(1)),
        colors.slice(0, weights.length),
      ),
      chartId: 'allocationChart',
    });
  }

  // Thesis status
  const aliveTheses = theses.theses?.filter((t: any) => t.status !== 'dead') || [];
  if (aliveTheses.length > 0) {
    const rows = aliveTheses.map((t: any) =>
      `<tr><td class="px-3 py-2 font-mono">${t.ticker}</td><td class="px-3 py-2">${t.status}</td><td class="px-3 py-2">${t.thesis.slice(0, 60)}</td></tr>`
    ).join('');
    sections.push({
      title: 'Active Theses',
      content: `<table class="w-full"><thead><tr><th class="px-3 py-2 text-left">Ticker</th><th class="px-3 py-2 text-left">Status</th><th class="px-3 py-2 text-left">Thesis</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
  }

  // Shadow positions
  const openShadow = shadow.entries?.filter((e: any) => e.status === 'open') || [];
  if (openShadow.length > 0) {
    const rows = openShadow.map((e: any) =>
      `<tr><td class="px-3 py-2 font-mono">${e.ticker}</td><td class="px-3 py-2">${e.action}</td><td class="px-3 py-2">${e.filledShares}/${e.totalShares}</td><td class="px-3 py-2">${e.timeHorizon || '-'}</td></tr>`
    ).join('');
    sections.push({
      title: 'Shadow Positions (Disciplined You)',
      content: `<table class="w-full"><thead><tr><th class="px-3 py-2 text-left">Ticker</th><th class="px-3 py-2 text-left">Action</th><th class="px-3 py-2 text-left">Filled</th><th class="px-3 py-2 text-left">Horizon</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
  }

  return renderReport({
    title: 'Portfolio Track Report',
    subtitle: 'Performance, allocation, and thesis status',
    date: today(),
    sections,
  });
}

function generateReflectReport(): string {
  const theses = readJSONSafe<any>(THESES_FILE, { theses: [] });

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
    const colors = { alive: '#22c55e', threatened: '#eab308', critical: '#ef4444', reinforced: '#3b82f6' };

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
    console.error(JSON.stringify({ error: 'Usage: finstack report sense|track|reflect [--no-open]' }));
    process.exit(1);
  }

  mkdirSync(REPORTS_DIR, { recursive: true });

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
      console.error(JSON.stringify({ error: `Unknown report type: ${type}. Use sense|track|reflect` }));
      process.exit(1);
      return; // unreachable but helps TS
  }

  const outPath = join(REPORTS_DIR, filename);
  writeFileSync(outPath, html);

  console.log(JSON.stringify({
    report: type,
    path: outPath,
    date: today(),
  }, null, 2));

  if (!noOpen) {
    openFile(outPath);
  }
}
