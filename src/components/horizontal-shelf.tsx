'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icon';

export function HorizontalShelf({ title, children, trackClassName = 'poster-track' }: {
  title: string;
  children: ReactNode;
  trackClassName?: string;
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
  }, [children]);

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
        className={`${trackClassName} -mx-1 p-1`}
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
          const cards = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-poster]'));
          const current = cards.indexOf(card);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1);
          event.preventDefault();
          cards[Math.max(0, Math.min(cards.length - 1, next))]?.focus();
        }}
      >
        {children}
      </div>
    </div>
  );
}

