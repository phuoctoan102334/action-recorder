import { describe, it, expect } from 'vitest';
import {
  deepMaskJSON, maskHeaders, maskFormBody, maskTextBody, maskBodyValue,
  shouldMaskKey, keywordMatches
} from '../../action-recorder/masking.js';

describe('U1: deepMaskJSON', () => {
  it('masks nested password and token by default', () => {
    const input = {
      user: {
        name: 'Alice',
        credentials: { password: 'secret', token: 'abc123' }
      }
    };
    const out = deepMaskJSON(input);
    expect(out.user.name).toBe('Alice');
    expect(out.user.credentials.password).toBe('[MASKED]');
    expect(out.user.credentials.token).toBe('[MASKED]');
  });

  it('always masks password/cvv even with userRecordKeys', () => {
    const keys = new Set(['password']);
    const out = deepMaskJSON({ password: 'x', cvv: '123', note: 'hi' }, keys);
    expect(out.password).toBe('[MASKED]');
    expect(out.cvv).toBe('[MASKED]');
    expect(out.note).toBe('hi');
  });

  it('userRecordKeys=record keeps cookie plaintext', () => {
    // cookies set to Record value → cookie in userRecordKeys
    const keys = new Set(['cookie']);
    const out = deepMaskJSON({ cookie: 'session=1' }, keys);
    expect(out.cookie).toBe('session=1');
  });

  it('custom keyword csrf_token masks via customKeywords', () => {
    const custom = new Set(['csrf_token']);
    const out = deepMaskJSON({ csrf_token: 'abc', other: 'v' }, new Set(), custom);
    expect(out.csrf_token).toBe('[MASKED]');
    expect(out.other).toBe('v');
  });

  it('masks arrays of objects', () => {
    const out = deepMaskJSON([{ password: 'a' }, { ok: 1 }]);
    expect(out[0].password).toBe('[MASKED]');
    expect(out[1].ok).toBe(1);
  });
});

describe('U2: maskHeaders', () => {
  it('always masks authorization and cookie headers', () => {
    const out = maskHeaders({
      Authorization: 'Bearer x',
      Cookie: 'a=b',
      'Set-Cookie': 'a=b',
      'X-Api-Key': 'k',
      'Content-Type': 'application/json'
    });
    expect(out.Authorization).toBe('[MASKED]');
    expect(out.Cookie).toBe('[MASKED]');
    expect(out['Set-Cookie']).toBe('[MASKED]');
    expect(out['X-Api-Key']).toBe('[MASKED]');
    expect(out['Content-Type']).toBe('application/json');
  });

  it('userRecordKeys cannot unmask always-masked headers', () => {
    const keys = new Set(['authorization']);
    const out = maskHeaders({ Authorization: 'Bearer x' }, keys);
    expect(out.Authorization).toBe('[MASKED]');
  });
});

describe('U3: maskFormBody', () => {
  it('masks password in form-urlencoded body', () => {
    const out = maskFormBody('user=alice&password=x&submit=1');
    expect(out).toContain('password=%5BMASKED%5D');
    expect(out).toContain('user=alice');
    expect(out).not.toContain('password=x');
  });
});

describe('U4: keywordMatches / shouldMaskKey', () => {
  it('author does NOT match auth', () => {
    expect(keywordMatches('author', 'auth')).toBe(false);
    expect(shouldMaskKey('author')).toBe(false);
  });

  it('password matches my_password field', () => {
    expect(keywordMatches('my_password', 'password')).toBe(true);
  });

  it('csrf_token matches custom keyword', () => {
    const custom = new Set(['csrf_token']);
    expect(shouldMaskKey('csrf_token', new Set(), custom)).toBe(true);
  });

  it('authorization matches auth as full word', () => {
    expect(keywordMatches('authorization', 'authorization')).toBe(true);
    expect(keywordMatches('oauth_token', 'token')).toBe(true);
  });
});

describe('maskTextBody / maskBodyValue (Mika condition: request AND response string)', () => {
  it('masks JSON-like string body', () => {
    const out = maskTextBody('{"password":"secret","name":"a"}');
    expect(out).toContain('"[MASKED]"');
    expect(out).not.toContain('secret');
    expect(out).toContain('"name":"a"');
  });

  it('masks form string body', () => {
    const out = maskTextBody('password=secret&name=a');
    expect(out).not.toContain('password=secret');
    expect(out).toContain('name=a');
  });

  it('maskBodyValue dispatches object and string', () => {
    expect(maskBodyValue({ token: 't' })).toEqual({ token: '[MASKED]' });
    expect(maskBodyValue('token=t')).not.toContain('token=t');
  });
});
