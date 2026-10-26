import { describe, expect, it, vi } from 'vitest';
import { hasRecommendationSource } from './recommendation-availability';
import type { SearchResultItem, VideoDetail } from './types';
const item = { id: '1', title: '生日快乐', cover: '' };
const sources = [{ key: 'a', name: 'A', url: 'https://a.example/api' }, { key: 'b', name: 'B', url: 'https://b.example/api' }];
const entry = (overrides: Partial<SearchResultItem> = {}): SearchResultItem => ({ sourceKey: 'a', sourceName: 'A', sourceUrl: sources[0].url, vodId: '1', name: item.title, ...overrides });
const video = (overrides: Partial<VideoDetail> = {}): VideoDetail => ({ episodes: ['https://media.example/full.m3u8'], videoInfo: { sourceKey: 'a', sourceName: 'A', title: item.title, remarks: '正片' }, ...overrides });
async function check(list: SearchResultItem[], detail = vi.fn(async () => video())) {
  const result = await hasRecommendationSource(item, sources, async () => ({ list }), detail, new AbortController().signal);
  return { result, detail };
}
describe('首页推荐片源验证', () => {
  it('同名正片有播放地址才展示，标点差异兼容', async () => {
    expect((await check([entry({ name: '生日 快乐！' })])).result).toBe(true);
    expect((await check([])).result).toBe(false);
  });
  it('同名相关影片和预告搜索结果不能当作正片', async () => {
    for (const row of [entry({ name: '生日快乐预告片' }), entry({ remarks: '预告片' }), entry({ typeName: '影视解说' })]) {
      const { result, detail } = await check([row]);
      expect(result).toBe(false); expect(detail).not.toHaveBeenCalled();
    }
  });
  it('详情明确为预告、无播放地址或片名不符时隐藏', async () => {
    for (const data of [video({ episodes: [] }), video({ episodes: ['javascript:alert(1)'] }), video({ videoInfo: { sourceKey: 'a', sourceName: 'A', remarks: '先导预告' } }), video({ videoInfo: { sourceKey: 'a', sourceName: 'A', title: '其他影片' } })]) {
      expect((await check([entry()], vi.fn(async () => data))).result).toBe(false);
    }
  });
  it('失败来源继续查找，不能借用同 key 的其他 URL', async () => {
    const detail = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(video());
    expect((await check([entry(), entry({ sourceKey: 'b', sourceUrl: sources[1].url })], detail)).result).toBe(true);
    expect((await check([entry({ sourceUrl: 'https://other.example/api' })])).result).toBe(false);
  });
  it('取消和认证失效不被作为普通无片源缓存', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(hasRecommendationSource(item, sources, async () => ({ list: [entry()] }), async () => video(), controller.signal)).rejects.toThrow();
    const detail = vi.fn().mockRejectedValue(Object.assign(new Error('login'), { status: 401 }));
    await expect(check([entry()], detail)).rejects.toThrow('login');
  });
});
