import { describe, it, expect } from 'bun:test';
import { padCIK, parseFilings } from '../../src/data/edgar';

describe('edgar', () => {
  it('padCIK pads to 10 digits', () => {
    expect(padCIK('320193')).toBe('0000320193');
    expect(padCIK('1234567890')).toBe('1234567890');
  });

  it('parseFilings extracts recent filings', () => {
    const raw = {
      cik: '320193',
      name: 'Apple Inc',
      tickers: ['AAPL'],
      filings: {
        recent: {
          accessionNumber: ['0000320193-24-000001', '0000320193-24-000002'],
          filingDate: ['2024-11-01', '2024-08-02'],
          form: ['10-K', '10-Q'],
          primaryDocument: ['aapl-20240928.htm', 'aapl-20240629.htm'],
          primaryDocDescription: ['Annual Report', 'Quarterly Report'],
        },
      },
    };
    const result = parseFilings('AAPL', raw);
    expect(result.ticker).toBe('AAPL');
    expect(result.cik).toBe('320193');
    expect(result.company).toBe('Apple Inc');
    expect(result.filings.length).toBe(2);
    expect(result.filings[0].type).toBe('10-K');
    expect(result.filings[0].date).toBe('2024-11-01');
    expect(result.filings[0].url).toContain('Archives/edgar/data/320193');
  });

  it('parseFilings filters to 10-K, 10-Q, 8-K only', () => {
    const raw = {
      cik: '320193',
      name: 'Apple Inc',
      tickers: ['AAPL'],
      filings: {
        recent: {
          accessionNumber: ['001', '002', '003'],
          filingDate: ['2024-11-01', '2024-10-15', '2024-08-02'],
          form: ['10-K', 'SC 13G', '8-K'],
          primaryDocument: ['a.htm', 'b.htm', 'c.htm'],
          primaryDocDescription: ['Annual', 'Ownership', 'Current'],
        },
      },
    };
    const result = parseFilings('AAPL', raw);
    expect(result.filings.length).toBe(2);
    expect(result.filings[0].type).toBe('10-K');
    expect(result.filings[1].type).toBe('8-K');
  });
});
