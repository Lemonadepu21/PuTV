import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { LookupAddress } from 'node:dns';
import { fetch as undiciFetch, Response } from 'undici';
import { fetchUpstream } from './fetch-utils';

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: vi.fn(actual.fetch) };
});

// 预检先看到公网地址，真正建立连接时同一域名变为本机地址。
vi.mock('node:dns/promises', () => ({
  default: { lookup: async () => [{ address: '93.184.216.34', family: 4 }] },
}));
vi.mock('node:dns', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:dns')>(),
  lookup: (_hostname: string, _options: unknown, cb: (err: null, result: LookupAddress[]) => void) => {
    cb(null, [{ address: '127.0.0.1', family: 4 }]);
  },
}));

/**
 * 安全跳转测试：mock Undici fetch，验证 302 跳转到内网地址会被拒绝，
 * 跳转到公网地址则正常跟随。使用字面量公网 IP 避免 DNS 依赖。
 */

const PUBLIC_URL = 'https://93.184.216.34/a';

function mockFetch(handlers: Array<(url: string) => Response>) {
  const fn = vi.mocked(undiciFetch).mockImplementation((url) => {
    const handler = handlers.shift();
    if (!handler) throw new Error('意外的额外请求: ' + url);
    return Promise.resolve(handler(String(url)));
  });
  return fn;
}

afterEach(async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  vi.mocked(undiciFetch).mockReset().mockImplementation(actual.fetch);
  vi.unstubAllEnvs();
});

describe('fetchUpstream 安全跳转', () => {
  it('302 跳转到内网地址时拒绝，且不发起第二跳请求', async () => {
    const spy = mockFetch([
      () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/secret' } }),
    ]);
    await expect(fetchUpstream(PUBLIC_URL)).rejects.toThrow(/跳转目标被拒绝/);
    expect(spy.mock.calls.length).toBe(1); // 预检在请求前拦截，内网地址未实际请求
  });

  it('302 跳转到公网地址时正常跟随并返回最终响应', async () => {
    mockFetch([
      () => new Response(null, { status: 302, headers: { location: 'https://93.184.216.34/b' } }),
      () => new Response('ok', { status: 200 }),
    ]);
    const res = await fetchUpstream(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('无跳转时直接返回响应', async () => {
    const spy = mockFetch([() => new Response('direct', { status: 200 })]);
    const res = await fetchUpstream(PUBLIC_URL);
    expect(await res.text()).toBe('direct');
    expect(spy.mock.calls.length).toBe(1);
  });

  it('重定向超过上限时抛错', async () => {
    mockFetch(Array.from({ length: 10 }, () => (url: string) =>
      new Response(null, { status: 302, headers: { location: url } })
    ));
    await expect(fetchUpstream(PUBLIC_URL)).rejects.toThrow(/重定向次数过多/);
  });

  it('底层连接解析到私网 IP 时转换抛出友好错误 (连接目标被拒绝)', async () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ERR_SSRF_BLOCKED', message: '目标地址解析到私有/保留网络 (127.0.0.1)' },
    });
    vi.mocked(undiciFetch).mockRejectedValue(err);
    await expect(fetchUpstream(PUBLIC_URL)).rejects.toThrow(/连接目标被拒绝: 目标地址解析到私有\/保留网络/);
  });

  it('safeRedirects 为 false 时，底层连接解析到私网 IP 也会转换抛出友好错误', async () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ERR_SSRF_BLOCKED', message: '目标地址解析到私有/保留网络 (127.0.0.1)' },
    });
    vi.mocked(undiciFetch).mockRejectedValue(err);
    await expect(fetchUpstream(PUBLIC_URL, { safeRedirects: false })).rejects.toThrow(
      /连接目标被拒绝: 目标地址解析到私有\/保留网络/
    );
  });
});

it('直播请求在连接阶段仍须遵守内网开关', async () => {
  const respond = vi.fn((_request: http.IncomingMessage, response: http.ServerResponse) => response.end('iptv'));
  const server = http.createServer(respond);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('本地测试服务未启动');
    const url = `http://rebind.example:${addr.port}/playlist.m3u`;
    vi.stubEnv('LIVE_ALLOW_PRIVATE', '0');
    await expect(fetchUpstream(url, { allowPrivate: true })).rejects.toThrow(/连接目标被拒绝/);
    expect(respond).not.toHaveBeenCalled();
    vi.stubEnv('LIVE_ALLOW_PRIVATE', '1');
    expect(await (await fetchUpstream(url, { allowPrivate: true })).text()).toBe('iptv');
    expect(respond).toHaveBeenCalledOnce();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
