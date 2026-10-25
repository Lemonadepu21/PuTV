import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategorySection } from './douban-section';
import type { BrowseCategory } from '@/lib/browse-categories';

const preferences = vi.hoisted(() => ({ recommendSource: 'hot-list', imageProxyMode: 'direct', customImageProxy: '' }));
vi.mock('@/lib/store', () => ({ useAppStore: (select: (state: typeof preferences) => unknown) => select(preferences) }));

function render(category: BrowseCategory, key: string[], data: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(key, data);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(CategorySection, { category, onPick: () => {} })
  ));
}
const movie = { id: '1', title: '缓存影片', cover: '' };

beforeEach(() => { preferences.recommendSource = 'hot-list'; });

describe('分类复用原推荐数据', () => {
  it('电影分类复用电影周榜缓存，使用网格且不渲染首页 Hero', () => {
    const html = render('movie', ['hot-list', 'douban_movie_weekly'], { items: [movie] });
    expect(html).toContain('查找 缓存影片 的片源');
    expect(html).toContain('poster-grid');
    expect(html).not.toContain('精选影视');
    expect(html).not.toContain('国产剧周榜');
  });

  it('剧集分类保留三种剧集榜单筛选，排除电影和综艺榜单', () => {
    const html = render('tv', ['hot-list', 'douban_tv_chinese'], { items: [movie] });
    for (const label of ['国产剧周榜', '海外剧周榜', '百度热播剧']) expect(html).toContain(label);
    expect(html).toContain('查找 缓存影片 的片源');
    expect(html).not.toContain('电影周榜');
    expect(html).not.toContain('国内综艺');
  });

  it.each(['douban', 'bangumi'])('%s 偏好下的电影分类复用豆瓣电影和原有标签', (source) => {
    preferences.recommendSource = source;
    const html = render('movie', ['douban', 'movie', '热门'], { items: [movie] });
    expect(html).toContain('查找 缓存影片 的片源');
    expect(html).toContain('热门电影');
    expect(html).toContain('豆瓣高分');
    expect(html).not.toContain('日剧');
  });

  it('豆瓣剧集分类使用原 tv 请求与标签', () => {
    preferences.recommendSource = 'douban';
    const html = render('tv', ['douban', 'tv', '热门'], { items: [movie] });
    expect(html).toContain('查找 缓存影片 的片源');
    expect(html).toContain('热门剧集');
    expect(html).toContain('日剧');
    expect(html).not.toContain('豆瓣高分');
  });

  it('动漫分类复用 Bangumi 日历全量数据，保留星期筛选', () => {
    const html = render('anime', ['bangumi-calendar'], { days: [{ weekday: 1, items: [movie] }] });
    expect(html).toContain('查找 缓存影片 的片源');
    expect(html).toContain('周一');
    expect(html).toContain('周日');
    expect(preferences.recommendSource).toBe('hot-list');
  });
});
