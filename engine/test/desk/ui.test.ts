import { describe, expect, it } from 'bun:test';
import { renderDeskApp, renderDeskCss, renderDeskHtml } from '../../src/desk/ui';

describe('Desk client bundle', () => {
  it('keeps its same-origin shell and inline app syntactically executable', () => {
    expect(renderDeskHtml()).toContain('<script src="/app.js" defer></script>');
    expect(renderDeskCss()).toContain('.book-hint');
    expect(renderDeskApp()).toContain('Only modeled holdings are included.');
    expect(renderDeskApp()).toContain('Start the loop');
    expect(() => new Function(renderDeskApp())).not.toThrow();
  });
});
