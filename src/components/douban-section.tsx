'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import type { BrowseCategory } from '@/lib/browse-categories';
import { RecommendationLayout } from './recommendation-layout';
import { HomeRecommendations } from './home-recommendations';

const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'];
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 首页推荐区：数据源由设置决定（豆瓣热门 / Bangumi 新番放送 / 影视热榜），按设置择一展示 */
export function RecommendSection({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);

  if (!doubanEnabled) return null;
  if (recommendSource === 'bangumi') return <BangumiView onPick={onPick} />;
  if (recommendSource === 'hot-list') return <HotListView onPick={onPick} />;
  return <DoubanView onPick={onPick} />;
}

/** 分类只复用当前推荐接口，首页来源偏好不因导航而改变。 */
export function CategorySection({ category, onPick }: { category: BrowseCategory; onPick: (title: string) => void }) {
  const source = useAppStore((s) => s.recommendSource);
  if (category === 'movie') return <MovieCategory onPick={onPick} />;
  if (category === 'anime') return <BangumiView layout="grid" onPick={onPick} />;
  if (source === 'hot-list') return <HotListView category={category} layout="grid" onPick={onPick} />;
  return <DoubanView category={category} layout="grid" onPick={onPick} />;
}

/** 电影浏览独立于首页偏好，按需加载当前标签。 */
function MovieCategory({ onPick }: { onPick: (title: string) => void }) {
  const [tag, setTag] = useState('热门');
  const weekly = tag === '电影周榜';
  const week = useQuery({
    queryKey: ['hot-list', 'douban_movie_weekly'],
    queryFn: ({ signal }) => api.hotList('douban_movie_weekly', signal),
    enabled: weekly,
  });
  const movies = useInfiniteQuery({
    queryKey: ['movie-browse', tag], initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => (await api.douban('movie', tag, pageParam, 50, signal)).items,
    getNextPageParam: (last, pages, offset) => {
      const seen = new Set(pages.slice(0, -1).flat().map((item) => item.id));
      return last.length === 50 && last.some((item) => !seen.has(item.id)) ? offset + 50 : undefined;
    },
    enabled: !weekly,
  });
  const items = weekly ? week.data?.items ?? [] : Array.from(new Map(movies.data?.pages.flat().map((item) => [item.id, item])).values());
  const query = weekly ? week : movies;
  return <>
    <RecommendationLayout layout="grid" title={weekly ? tag : `${tag}电影`} items={items}
      loading={query.isPending} error={query.isError && items.length === 0}
      onRetry={() => { void query.refetch(); }} onPick={onPick}>
      <div className="flex flex-wrap gap-1.5">
        {['电影周榜', ...MOVIE_TAGS].map((name) => <ChipButton key={name} active={tag === name} onClick={() => setTag(name)}>{name}</ChipButton>)}
      </div>
    </RecommendationLayout>
    {!weekly && items.length > 0 && (movies.hasNextPage || movies.isFetchNextPageError) && <div className="content-container mt-8 text-center">
      {movies.isFetchNextPageError && <p role="status" className="mb-3 text-sm text-muted">加载失败，请重试</p>}
      <button type="button" className="btn-ghost min-h-11" disabled={movies.isFetchingNextPage} onClick={() => { void movies.fetchNextPage(); }}>
        {movies.isFetchingNextPage ? '加载中…' : movies.isFetchNextPageError ? '重试' : '加载更多'}
      </button>
    </div>}
  </>;
}

/**
 * 豆瓣推荐：影视切换 + 标签筛选。
 * 数据一次拉全（50 条），横向列表复用原条目与懒加载海报。
 */
function DoubanView({ onPick, category, layout = 'home' }: { onPick: (title: string) => void; category?: 'movie' | 'tv'; layout?: 'home' | 'grid' }) {
  const [type, setType] = useState<'movie' | 'tv'>(category || 'movie');
  const [tag, setTag] = useState('热门');

  const query = useQuery({
    queryKey: ['douban', type, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 50, signal),
  });

  const tags = type === 'movie' ? MOVIE_TAGS : TV_TAGS;
  const items = query.data?.items ?? [];

  const switchType = (t: 'movie' | 'tv') => {
    if (t === type) return;
    setType(t);
    setTag('热门');
  };

  const Layout = layout === 'home' ? HomeRecommendations : RecommendationLayout;
  return (
    <Layout
      layout={layout}
      title={`${tag}${type === 'movie' ? '电影' : '剧集'}`}
      items={items} loading={query.isLoading} error={query.isError}
      onRetry={() => { void query.refetch(); }} onPick={onPick}
    >
      {!category && <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex bg-chip rounded-lg p-0.5">
            <TypeButton active={type === 'movie'} onClick={() => switchType('movie')}>
              电影
            </TypeButton>
            <TypeButton active={type === 'tv'} onClick={() => switchType('tv')}>
              剧集
            </TypeButton>
          </div>
        </div>
      </div>}

      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <button
            key={t}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs transition-colors',
              t === tag ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
            )}
            onClick={() => setTag(t)}
            aria-pressed={t === tag}
          >
            {t}
          </button>
        ))}
      </div>
    </Layout>
  );
}

/** Bangumi 每日放送：星期筛选，一次拉全量无分页 */
function BangumiView({ onPick, layout = 'home' }: { onPick: (title: string) => void; layout?: 'home' | 'grid' }) {
  const [weekday, setWeekday] = useState<number | 'all'>('all');

  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });

  let items: DoubanItem[] = [];
  if (query.data) {
    items = weekday === 'all'
      ? query.data.days.flatMap((d) => d.items)
      : (query.data.days.find((d) => d.weekday === weekday)?.items ?? []);
  }

  const Layout = layout === 'home' ? HomeRecommendations : RecommendationLayout;
  return (
    <Layout
      layout={layout}
      title={weekday === 'all' ? '新番放送' : `${WEEKDAYS[weekday - 1]}新番`}
      items={items} loading={query.isLoading} error={query.isError}
      onRetry={() => { void query.refetch(); }} onPick={onPick}
    >
      <div className="flex flex-wrap gap-1.5">
        <ChipButton active={weekday === 'all'} onClick={() => setWeekday('all')}>
          全部
        </ChipButton>
        {WEEKDAYS.map((name, i) => (
          <ChipButton key={name} active={weekday === i + 1} onClick={() => setWeekday(i + 1)}>
            {name}
          </ChipButton>
        ))}
      </div>
    </Layout>
  );
}

const HOT_LISTS = [
  { id: 'douban_movie_weekly', label: '电影周榜' },
  { id: 'douban_tv_chinese', label: '国产剧周榜' },
  { id: 'douban_tv_global', label: '海外剧周榜' },
  { id: 'douban_show_chinese', label: '国内综艺' },
  { id: 'douban_show_global', label: '海外综艺' },
  { id: 'baidu_teleplay', label: '百度热播剧' },
];

/** 影视热榜（60s API）：豆瓣五个周榜 + 百度热播剧，chips 切换 */
function HotListView({ onPick, category, layout = 'home' }: { onPick: (title: string) => void; category?: 'movie' | 'tv'; layout?: 'home' | 'grid' }) {
  const lists = category === 'movie' ? HOT_LISTS.slice(0, 1) : category === 'tv'
    ? HOT_LISTS.filter((list) => ['douban_tv_chinese', 'douban_tv_global', 'baidu_teleplay'].includes(list.id))
    : HOT_LISTS;
  const [listId, setListId] = useState(lists[0].id);

  const query = useQuery({
    queryKey: ['hot-list', listId],
    queryFn: ({ signal }) => api.hotList(listId, signal),
  });

  const items = query.data?.items ?? [];

  const Layout = layout === 'home' ? HomeRecommendations : RecommendationLayout;
  return (
    <Layout
      layout={layout}
      title={lists.find((list) => list.id === listId)!.label}
      items={items} loading={query.isLoading} error={query.isError}
      onRetry={() => { void query.refetch(); }} onPick={onPick}
    >
      <div className="flex flex-wrap gap-1.5">
        {lists.map((l) => (
          <ChipButton key={l.id} active={listId === l.id} onClick={() => setListId(l.id)}>
            {l.label}
          </ChipButton>
        ))}
      </div>
    </Layout>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'px-2.5 py-1 rounded-full text-xs transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn('px-3.5 py-1.5 rounded-md text-sm transition-colors', active ? 'bg-accent text-on-accent' : 'text-muted hover:text-content')}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
