'use client';

import { useState, type ReactNode } from 'react';
import type { DoubanItem } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { DoubanCard } from './video-card';
import { Icon } from './icon';
import { SmartImage } from './smart-image';
import { HorizontalShelf } from './horizontal-shelf';
import { ContinueWatching } from './continue-watching';

export function RecommendationLayout({
  title, items, loading, error, onRetry, onPick, children, layout = 'home',
}: {
  layout?: 'home' | 'grid';
  title: string;
  items: DoubanItem[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onPick: (title: string) => void;
  children?: ReactNode;
}) {
  return (
    <>
      {layout === 'home' && <RecommendationHero key={title} title={title} items={error ? [] : items} loading={loading} onPick={onPick} />}
      {layout === 'home' && <ContinueWatching />}
      <section id="recommendations" aria-label={layout === 'grid' ? title : '推荐片单'} className={`content-container ${layout === 'grid' ? 'py-8 sm:py-10' : 'pt-7 sm:pt-10'}`}>
        {layout === 'grid' && <h1 className="mb-6 text-2xl sm:text-3xl font-semibold tracking-tight">{title}</h1>}
        <div className="mb-5 space-y-3">{children}</div>
        {error ? (
          <div role="status" className="rounded-xl bg-surface py-10 text-center">
            <p className="text-sm text-muted">推荐内容加载失败</p>
            <button type="button" className="btn-ghost mt-4" onClick={onRetry}>重试</button>
          </div>
        ) : loading ? (
          <ShelfSkeleton layout={layout} />
        ) : items.length === 0 ? (
          <p role="status" className="py-10 text-sm text-muted">该分类暂无推荐内容</p>
        ) : layout === 'grid' ? (
          <div className="poster-grid" role="list" aria-label={title}>
            {items.map((item) => <div role="listitem" key={item.id} className="min-w-0"><DoubanCard item={item} onClick={() => onPick(item.title)} /></div>)}
          </div>
        ) : (
          <HorizontalShelf key={title} title={title}>
            {items.map((item) => <div role="listitem" key={item.id} className="min-w-0"><DoubanCard item={item} onClick={() => onPick(item.title)} /></div>)}
          </HorizontalShelf>
        )}
      </section>
    </>
  );
}

function RecommendationHero({ title, items, loading, onPick }: {
  title: string;
  items: DoubanItem[];
  loading: boolean;
  onPick: (title: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const mode = useAppStore((s) => s.imageProxyMode);
  const customProxy = useAppStore((s) => s.customImageProxy);
  const featured = items.slice(0, 5);
  const activeIndex = Math.min(index, Math.max(0, featured.length - 1));
  const item = featured[activeIndex];

  return (
    <section aria-label="精选影视" aria-busy={loading} className="cinema-hero relative isolate overflow-hidden">
      {item?.cover && (
        <div aria-hidden="true" className="absolute inset-0">
          <SmartImage key={item.cover} url={item.cover} mode={mode} customProxy={customProxy} alt="" loading="eager" className="h-full w-full object-cover object-[center_35%]" />
        </div>
      )}
      <div aria-hidden="true" className="cinema-hero-shade absolute inset-0" />
      <div className="content-container relative flex h-full flex-col justify-end pb-6 sm:pb-10">
        {item?.cover && (
          <div aria-hidden="true" className="cinema-hero-artwork">
            <SmartImage key={item.cover} url={item.cover} mode={mode} customProxy={customProxy} alt="" loading="eager" className="h-full w-full object-contain" />
          </div>
        )}
        <div className={`relative max-w-2xl ${item?.cover ? 'cinema-hero-copy' : ''}`}>
          <p className="mb-3 text-xs font-medium tracking-widest text-white/75">{title}</p>
          {loading ? (
            <div role="status" aria-label="正在加载推荐" className="space-y-5">
              <div className="h-10 w-3/4 rounded bg-white/10 animate-pulse" />
              <div className="h-10 w-28 rounded-lg bg-white/10 animate-pulse" />
            </div>
          ) : (
            <>
              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-semibold leading-tight tracking-tight text-white line-clamp-2">{item?.title || '今日片单'}</h1>
              {item && (
                <>
                  <div className="mt-3 flex items-center gap-3 text-sm text-white/80">
                    {typeof item.isTv === 'boolean' && <span>{item.isTv ? '剧集' : '电影'}</span>}
                    {item.rating && <span>评分 {item.rating}</span>}
                  </div>
                  <button type="button" onClick={() => onPick(item.title)} className="btn-primary mt-4 sm:mt-6 min-h-11 px-5 font-medium">
                    <Icon name="search" className="h-4 w-4" />查看片源
                  </button>
                </>
              )}
            </>
          )}
        </div>
        {featured.length > 1 && (
          <div className="relative mt-6 flex items-center gap-3" aria-label="切换精选影片">
            <span aria-live="polite" aria-atomic="true" className="min-w-12 text-xs tabular-nums text-white/80">{activeIndex + 1} / {featured.length}</span>
            <button type="button" className="hero-step" aria-label="上一部精选" onClick={() => setIndex((activeIndex + featured.length - 1) % featured.length)}><Icon name="chevronDown" className="h-5 w-5 rotate-90" /></button>
            <button type="button" className="hero-step" aria-label="下一部精选" onClick={() => setIndex((activeIndex + 1) % featured.length)}><Icon name="chevronDown" className="h-5 w-5 -rotate-90" /></button>
          </div>
        )}
      </div>
    </section>
  );
}

function ShelfSkeleton({ layout }: { layout: 'home' | 'grid' }) {
  return (
    <div role="status" aria-label="正在加载片单">
      <div className="mb-4 h-6 w-28 rounded bg-chip animate-pulse" />
      <div className={layout === 'grid' ? 'poster-grid' : 'poster-track overflow-hidden'} aria-hidden="true">
        {Array.from({ length: layout === 'grid' ? 12 : 7 }, (_, index) => <div key={index}><div className="aspect-[2/3] rounded-xl bg-chip animate-pulse" /><div className="mt-3 h-4 w-3/4 rounded bg-chip animate-pulse" /></div>)}
      </div>
    </div>
  );
}
