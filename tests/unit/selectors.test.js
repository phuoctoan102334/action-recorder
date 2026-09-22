// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';

let S;
beforeAll(async () => {
  if (typeof global.CSS === 'undefined' || !global.CSS.escape) {
    global.CSS = global.CSS || {};
    global.CSS.escape = (v) => String(v).replace(/[^\w-]/g, ch => '\\' + ch);
  }
  await import('../../action-recorder/selectors.js');
  S = globalThis.ActionRecorderSelectors;
});

describe('U6: selectors', () => {
  it('builds #id candidate', () => {
    document.body.innerHTML = '<button id="submit-btn">Submit</button>';
    const el = document.getElementById('submit-btn');
    const c = S.buildCssSelectors(el);
    expect(c[0]).toBe('#submit-btn');
  });

  it('prefers data-testid attribute candidate', () => {
    document.body.innerHTML = '<div data-testid="login-form"></div>';
    const el = document.querySelector('[data-testid]');
    const c = S.buildCssSelectors(el);
    expect(c).toContain('[data-testid="login-form"]');
  });

  it('excludes hash-like classes from stable selectors', () => {
    document.body.innerHTML = '<span class="css-a1b2c3 label">x</span>';
    const el = document.querySelector('span');
    expect(S.isHashClass('css-a1b2c3')).toBe(true);
    expect(S.isHashClass('label')).toBe(false);
    const c = S.buildCssSelectors(el);
    const classCandidates = c.filter(x => x.includes('.'));
    for (const cand of classCandidates) {
      expect(cand).not.toContain('css-a1b2c3');
    }
    expect(c).toContain('span.label');
  });

  it('builds domPath with sibling index', () => {
    document.body.innerHTML = '<div><p>a</p><p id="second">b</p></div>';
    const el = document.getElementById('second');
    const p = S.buildDomPath(el);
    expect(p).toContain('p[1]');
  });

  it('getTargetMetadata returns full shape with sensitive=false default', () => {
    document.body.innerHTML = '<input type="text" name="search">';
    const el = document.querySelector('input');
    const meta = S.getTargetMetadata(el);
    expect(meta.tag).toBe('input');
    expect(meta.name).toBe('search');
    expect(meta.sensitive).toBe(false);
    expect(Array.isArray(meta.cssSelectorCandidates)).toBe(true);
    expect(typeof meta.xpath).toBe('string');
  });

  it('xpath uses id when present', () => {
    document.body.innerHTML = '<div id="unique"></div>';
    const el = document.getElementById('unique');
    expect(S.buildXPath(el)).toBe('//*[@id="unique"]');
  });
});
