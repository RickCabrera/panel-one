import { createHash } from 'node:crypto';

import { generarApiKey, hashApiKey, PREFIJO_API_KEY } from './api-key';

describe('API key de agente', () => {
  it('lleva el prefijo y 32 bytes aleatorios en base64url', () => {
    const key = generarApiKey();
    expect(key.startsWith(PREFIJO_API_KEY)).toBe(true);
    const cuerpo = key.slice(PREFIJO_API_KEY.length);
    expect(cuerpo).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(cuerpo, 'base64url')).toHaveLength(32);
  });

  it('no repite keys', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generarApiKey()));
    expect(keys.size).toBe(50);
  });

  it('el hash es SHA-256 hex, determinista y distinto de la key', () => {
    const key = generarApiKey();
    const hash = hashApiKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toBe(createHash('sha256').update(key).digest('hex'));
    expect(hash).not.toContain(key.slice(PREFIJO_API_KEY.length));
    expect(hashApiKey(generarApiKey())).not.toBe(hash);
  });
});
