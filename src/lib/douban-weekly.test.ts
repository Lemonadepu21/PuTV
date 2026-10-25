import { beforeEach, describe, expect, it, vi } from 'vitest';
import { baiduTeleplayToItem, doubanWeeklyToItem, fetchHotList, isHotListId } from './douban-weekly';

import { fetchUpstream, getCache, setCache } from './fetch-utils';

vi.mock('./fetch-utils', () => ({
  fetchUpstream: vi.fn(), getCache: vi.fn(), setCache: vi.fn(),
}));

describe('isHotListId', () => {
  it('白名单校验', () => {
    expect(isHotListId('douban_movie_weekly')).toBe(true);
    expect(isHotListId('baidu_teleplay')).toBe(true);
    expect(isHotListId('maoyan')).toBe(false);
    expect(isHotListId('')).toBe(false);
  });
});

describe('doubanWeeklyToItem', () => {
  it('评分、封面（原生地址优先）、isTv 正确映射', () => {
    const item = doubanWeeklyToItem(
      {
        id: 36808876,
        title: '奥德赛',
        rating: 8.6,
        cover_proxy: 'https://doubanio.viki.moe/view/photo/p1.jpg',
        cover: 'https://img9.doubanio.com/view/photo/p1.jpg',
      },
      false
    );
    // 原生 doubanio 地址命中图片代理白名单并带 Referer 伪装，优先于 cover_proxy 镜像
    expect(item).toEqual({
      id: '36808876',
      title: '奥德赛',
      cover: 'https://img9.doubanio.com/view/photo/p1.jpg',
      rating: '8.6',
      isTv: false,
    });
  });

  it('原生 cover 缺失时回退 cover_proxy，0 分不输出 rating', () => {
    const item = doubanWeeklyToItem(
      { id: 2, title: 'y', cover_proxy: 'https://doubanio.viki.moe/view/photo/p2.jpg' },
      true
    );
    expect(item).toMatchObject({ cover: 'https://doubanio.viki.moe/view/photo/p2.jpg', isTv: true });
    const zero = doubanWeeklyToItem({ id: 1, title: 'x', cover: 'c', rating: 0 }, true);
    expect(zero).toMatchObject({ cover: 'c', isTv: true });
    expect(zero?.rating).toBeUndefined();
  });

  it('缺 id、标题或封面的脏数据丢弃', () => {
    expect(doubanWeeklyToItem({ title: 'x', cover: 'c' }, false)).toBeUndefined();
    expect(doubanWeeklyToItem({ id: 1, cover: 'c' }, false)).toBeUndefined();
    expect(doubanWeeklyToItem({ id: 1, title: 'x' }, false)).toBeUndefined();
  });
});

describe('baiduTeleplayToItem', () => {
  it('用序号生成 id，不输出 rating', () => {
    expect(baiduTeleplayToItem({ title: '某剧', cover: 'https://img.example/1.jpg' }, 3)).toEqual({
      id: 'baidu_3',
      title: '某剧',
      cover: 'https://img.example/1.jpg',
      isTv: true,
    });
  });

  it('无海报条目丢弃', () => {
    expect(baiduTeleplayToItem({ title: '某剧', cover: null }, 0)).toBeUndefined();
  });
});

describe('首页周榜过滤', () => {
  const movie = { id: '37322586', title: '生日快乐', cover: 'https://example.com/poster.jpg', rating: 8.9 };
  beforeEach(() => vi.resetAllMocks());

  function respond(data: unknown) {
    vi.mocked(fetchUpstream).mockResolvedValue(new Response(JSON.stringify({ data })));
  }

  it.each(['预告', '预告片', '先导预告', '先导片', '待上映', '即将上映', '未上映', '院线热映'])(
    '排除明确标记为 %s 的影片，不增加上游请求', async (tag) => {
      respond([{ ...movie, tags: ['剧情', ` ${tag} `] }, { ...movie, id: '2', title: '其他影片', tags: ['剧情'] }]);
      expect((await fetchHotList('douban_movie_weekly')).map((item) => item.id)).toEqual(['2']);
      expect(fetchUpstream).toHaveBeenCalledTimes(1);
    }
  );

  it('不按片名硬编码，未标记的同名正片和正常题材保留', async () => {
    respond([movie, { ...movie, id: '2', title: '预告犯', tags: ['悬疑'] }]);
    expect((await fetchHotList('douban_movie_weekly')).map((item) => item.title)).toEqual(['生日快乐', '预告犯']);
  });

  it('异常或缺失标签不使整份榜单报错，也不误删条目', async () => {
    respond([{ ...movie, tags: '院线热映' }, { ...movie, id: '2', tags: [null, 123, {}] }]);
    expect(await fetchHotList('douban_movie_weekly')).toHaveLength(2);
  });

  it('全部被过滤时返回并缓存空片单，避免变成错误或重复请求', async () => {
    respond([{ ...movie, tags: ['院线热映'] }]);
    expect(await fetchHotList('douban_movie_weekly')).toEqual([]);
    expect(setCache).toHaveBeenCalledWith('hot-list:douban_movie_weekly', [], 3600000);
  });

  it('上游本身为空时继续报告原有数据异常', async () => {
    respond([]);
    await expect(fetchHotList('douban_movie_weekly')).rejects.toThrow('榜单数据为空');
  });

  it('缓存命中时不请求上游', async () => {
    vi.mocked(getCache).mockReturnValue([]);
    expect(await fetchHotList('douban_movie_weekly')).toEqual([]);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
});
