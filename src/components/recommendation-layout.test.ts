import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecommendationLayout } from './recommendation-layout';

const items = Array.from({ length: 8 }, (_, index) => ({
  id: String(index), title: `影片 ${index}`, cover: '',
}));

function render(overrides: Partial<ComponentProps<typeof RecommendationLayout>> = {}) {
  return renderToStaticMarkup(createElement(RecommendationLayout, {
    title: '电影周榜', items, loading: false, error: false,
    onRetry: () => {}, onPick: () => {}, ...overrides,
  }, '原有筛选'));
}

describe('推荐展示', () => {
  it('Hero 只精选前五项，片单保留所有条目及原搜索入口', () => {
    const html = render();
    expect(html.match(/role="listitem"/g)).toHaveLength(items.length);
    expect(html).toContain('1 / 5');
    expect(html).toContain('下一部精选');
    expect(html).toContain('查找 影片 7 的片源');
    expect(html).toContain('原有筛选');
  });

  it('缺少海报、评分或类型时显示占位，不编造元数据', () => {
    const html = render({ items: [items[0]] });
    expect(html).toContain('暂无海报');
    expect(html).not.toContain('src=""');
    expect(html).not.toContain('评分');
    expect(html).not.toContain('下一部精选');
    expect(html).not.toContain('剧集');
  });

  it('加载状态保留 Hero 和片单骨架，不显示可点击的虚构影片', () => {
    const html = render({ items: [], loading: true });
    expect(html).toContain('正在加载推荐');
    expect(html).toContain('正在加载片单');
    expect(html).not.toContain('查看片源');
  });

  it('空列表和失败状态有明确提示，失败可重试', () => {
    expect(render({ items: [] })).toContain('该分类暂无推荐内容');
    const failed = render({ error: true });
    expect(failed).toContain('推荐内容加载失败');
    expect(failed).toContain('重试');
    expect(failed).not.toContain('role="listitem"');
    expect(failed).not.toContain('查看片源');
  });

  it('只展示数据已提供的评分和类型', () => {
    const html = render({ items: [{ ...items[0], isTv: true, rating: '8.4' }] });
    expect(html).toContain('剧集');
    expect(html).toContain('评分 8.4');
  });

  it('分类网格保留全部影片及原筛选，不混入首页轮播或横向片单', () => {
    const html = render({ layout: 'grid' });
    expect(html.match(/role="listitem"/g)).toHaveLength(items.length);
    expect(html).toContain('原有筛选');
    expect(html).toContain('poster-grid');
    expect(html).not.toContain('精选影视');
    expect(html).not.toContain('poster-track');
  });

  it('分类加载、空和错误状态继续可用', () => {
    expect(render({ layout: 'grid', loading: true, items: [] })).toContain('正在加载片单');
    expect(render({ layout: 'grid', items: [] })).toContain('该分类暂无推荐内容');
    expect(render({ layout: 'grid', error: true })).toContain('重试');
  });

});
