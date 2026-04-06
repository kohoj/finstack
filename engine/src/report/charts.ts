// engine/src/report/charts.ts

export interface ChartConfig {
  type: string;
  data: { labels: string[]; datasets: any[] };
  options?: Record<string, any>;
}

export function lineChart(
  labels: string[],
  datasets: { label: string; data: number[]; color: string }[],
): ChartConfig {
  return {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map(ds => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.color,
        backgroundColor: ds.color + '20',
        fill: false,
        tension: 0.1,
      })),
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#e5e7eb' } } },
      scales: {
        x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
        y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
      },
    },
  };
}

export function barChart(
  labels: string[],
  datasets: { label: string; data: number[]; color: string }[],
): ChartConfig {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map(ds => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: ds.color + '80',
        borderColor: ds.color,
        borderWidth: 1,
      })),
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#e5e7eb' } } },
      scales: {
        x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
        y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
      },
    },
  };
}

export function pieChart(
  labels: string[],
  data: number[],
  colors: string[],
): ChartConfig {
  return {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + '80'),
        borderColor: colors,
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#e5e7eb' } } },
    },
  };
}

export function heatmapTable(
  labels: string[],
  matrix: number[][],
): string {
  // Generate an HTML table with color-coded cells for correlation matrix
  const colorFor = (v: number): string => {
    if (v >= 0.8) return '#ef4444';   // red - high positive
    if (v >= 0.5) return '#f97316';   // orange
    if (v >= 0.2) return '#eab308';   // yellow
    if (v > -0.2) return '#6b7280';   // gray - neutral
    if (v > -0.5) return '#3b82f6';   // blue
    return '#2563eb';                  // deep blue - negative
  };

  let html = '<table class="w-full text-sm"><thead><tr><th></th>';
  for (const l of labels) html += `<th class="px-2 py-1">${l}</th>`;
  html += '</tr></thead><tbody>';
  for (let i = 0; i < labels.length; i++) {
    html += `<tr><td class="font-bold px-2 py-1">${labels[i]}</td>`;
    for (let j = 0; j < labels.length; j++) {
      const v = matrix[i][j];
      const bg = colorFor(v);
      html += `<td class="px-2 py-1 text-center" style="background-color:${bg}40;color:${bg}">${v.toFixed(2)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}
