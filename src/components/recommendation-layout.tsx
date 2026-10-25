'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DoubanItem } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { DoubanCard } from './video-card';
import { Icon } from './icon';
import { SmartImage } from './smart-image';

export function RecommendationLayout({
  title, items, loading, error, onRetry, onPick, children,
}: {
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
      <RecommendationHero key={title} title={title} items={error ? [] : items} loading={loading} onPick={onPick} />
      <section id="recommendations" aria-label="推荐片单" className="content-container pt-7 sm:pt-10">
        <div className="mb-5 space-y-3">{children}</div>
        {error ? (
          <div role="status" className="rounded-xl bg-surface py-10 text-center">
            <p className="text-sm text-muted">推荐内容加载失败</p>
            <button type="button" className="btn-ghost mt-4" onClick={onRetry}>重试</button>
          </div>
        ) : loading ? (
          <ShelfSkeleton />
        ) : items.length === 0 ? (
          <p role="status" className="py-10 text-sm text-muted">该分类暂无推荐内容</p>
        ) : (
          <PosterShelf key={title} title={title} items={items} onPick={onPick} />
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

function PosterShelf({ title, items, onPick }: {
  title: string;
  items: DoubanItem[];
  onPick: (title: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => {
      setCanBack(track.scrollLeft > 1);
      setCanForward(track.scrollLeft + track.clientWidth < track.scrollWidth - 1);
    };
    // 只在可横向滚动时接管鼠标滚轮；边界处继续正常滚动页面。
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || event.deltaX !== 0) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * track.clientWidth : event.deltaY;
      if (Math.abs(delta) < 40) return;
      const remaining = event.deltaY > 0
        ? track.scrollWidth - track.clientWidth - track.scrollLeft
        : track.scrollLeft;
      if (remaining <= 1) return;
      event.preventDefault();
      const cardWidth = track.firstElementChild?.clientWidth ?? 0;
      track.scrollLeft += Math.sign(delta) * Math.max(Math.abs(delta), cardWidth);
    };
    update();
    track.addEventListener('scroll', update, { passive: true });
    track.addEventListener('wheel', wheel, { passive: false });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(track);
    window.addEventListener('resize', update);
    return () => {
      track.removeEventListener('scroll', update);
      track.removeEventListener('wheel', wheel);
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [items]);

  const scroll = (direction: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  return (
    <div className="poster-shelf group/shelf">
      <div className="mb-4 flex min-h-10 items-center justify-between gap-4">
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{title}</h2>
        <div className="flex items-center gap-2" aria-label={`${title}列表控制`}>
          <button type="button" className="shelf-step" aria-label={`向前浏览${title}`} disabled={!canBack} onClick={() => scroll(-1)}><Icon name="chevronDown" className="h-4 w-4 rotate-90" /></button>
          <button type="button" className="shelf-step" aria-label={`向后浏览${title}`} disabled={!canForward} onClick={() => scroll(1)}><Icon name="chevronDown" className="h-4 w-4 -rotate-90" /></button>
        </div>
      </div>
      <div
        ref={trackRef}
        className="poster-track -mx-1 p-1"
        role="list"
        aria-label={title}
        onFocusCapture={(event) => {
          const card = (event.target as HTMLElement).closest<HTMLElement>('[data-poster]');
          card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const card = (event.target as HTMLElement).closest<HTMLElement>('[data-poster]');
          if (!card) return;
          const cards = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-poster]'));
          const current = cards.indexOf(card as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1);
          event.preventDefault();
          cards[Math.max(0, Math.min(cards.length - 1, next))]?.focus();
        }}
      >
        {items.map((item) => (
          <div role="listitem" key={item.id} className="min-w-0"><DoubanCard item={item} onClick={() => onPick(item.title)} /></div>
        ))}
      </div>
    </div>
  );
}

function ShelfSkeleton() {
  return (
    <div role="status" aria-label="正在加载片单">
      <div className="mb-4 h-6 w-28 rounded bg-chip animate-pulse" />
      <div className="poster-track overflow-hidden" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => <div key={index}><div className="aspect-[2/3] rounded-xl bg-chip animate-pulse" /><div className="mt-3 h-4 w-3/4 rounded bg-chip animate-pulse" /></div>)}
      </div>
    </div>
  );
}
