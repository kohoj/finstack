import { describe, it, expect } from 'bun:test';
import { renderReport } from '../../src/report/templates';
import { lineChart, barChart, pieChart, heatmapTable } from '../../src/report/charts';

describe('charts', () => {
  it('generates line chart config', () => {
    const config = lineChart(['Jan', 'Feb'], [{ label: 'SPY', data: [100, 105], color: '#3b82f6' }]);
    expect(config.type).toBe('line');
    expect(config.data.labels).toEqual(['Jan', 'Feb']);
    expect(config.data.datasets[0].label).toBe('SPY');
  });

  it('generates bar chart config', () => {
    const config = barChart(['A', 'B'], [{ label: 'Count', data: [3, 5], color: '#ef4444' }]);
    expect(config.type).toBe('bar');
    expect(config.data.datasets[0].data).toEqual([3, 5]);
  });

  it('generates pie chart config', () => {
    const config = pieChart(['NVDA', 'AAPL'], [60, 40], ['#ef4444', '#3b82f6']);
    expect(config.type).toBe('pie');
    expect(config.data.datasets[0].data).toEqual([60, 40]);
  });

  it('generates heatmap table HTML', () => {
    const html = heatmapTable(['A', 'B'], [[1.0, 0.5], [0.5, 1.0]]);
    expect(html).toContain('<table');
    expect(html).toContain('1.00');
    expect(html).toContain('0.50');
  });
});

describe('templates', () => {
  it('renders a complete HTML report', () => {
    const html = renderReport({
      title: 'Test Report',
      subtitle: 'Testing',
      date: '2026-04-07',
      sections: [
        { title: 'Section 1', content: '<p>Hello</p>' },
        {
          title: 'Chart Section',
          content: '<p>With chart</p>',
          chart: barChart(['A'], [{ label: 'X', data: [1], color: '#fff' }]),
          chartId: 'testChart',
        },
      ],
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Report');
    expect(html).toContain('Testing');
    expect(html).toContain('Section 1');
    expect(html).toContain('Chart Section');
    expect(html).toContain('testChart');
    expect(html).toContain('chart.js');
    expect(html).toContain('tailwindcss');
  });

  it('renders without subtitle', () => {
    const html = renderReport({
      title: 'Simple',
      date: '2026-04-07',
      sections: [],
    });
    expect(html).toContain('Simple');
    expect(html).not.toContain('undefined');
  });
});
