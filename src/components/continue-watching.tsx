'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from './auth';
import { db } from '@/lib/db';
import { continueWatching } from '@/lib/continue-watching';
import { resolveSource, useAppStore } from '@/lib/store';
import { buildWatchUrl, formatTime } from '@/lib/utils';
import { HorizontalShelf } from './horizontal-shelf';
import { SmartImage } from './smart-image';
import { Icon } from './icon';

export function ContinueWatching() {
  const { verified } = useAuth();
  const mode = useAppStore((s) => s.imageProxyMode);
  const customProxy = useAppStore((s) => s.customImageProxy);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const entries = useLiveQuery(async () => {
    if (!verified) return [];
    // 同一快照读取摘要和分集进度，沿用当前档案已隔离的同步缓存。
    return db.transaction('r', db.history, db.progress, async () => continueWatching(
      await db.history.toArray(), await db.progress.toArray(),
    )).catch(() => []);
  }, [verified]);
  if (!entries?.length) return null;

  return (
    <section aria-label="继续观看" className="content-container pt-7 sm:pt-10">
      <HorizontalShelf title="继续观看" trackClassName="continue-track">
        {entries.map((item) => {
          const source = resolveSource({ customAPIs, envSources }, item.sourceKey, { url: item.sourceUrl });
          const percent = item.duration > 0 ? Math.min(100, Math.round(item.playbackPosition / item.duration * 100)) : 0;
          const episode = item.totalEpisodes > 1 ? `第 ${item.episodeIndex + 1} 集` : '';
          const time = item.playbackPosition > 0 ? `已看 ${formatTime(item.playbackPosition)}` : '尚未开始';
          return (
            <div key={item.id} role="listitem" className="min-w-0">
              <Link data-poster href={buildWatchUrl({ sourceKey: item.sourceKey, vodId: item.vodId, index: item.episodeIndex, title: item.title, sourceUrl: source?.url, detail: source?.detail })}
                className="group block rounded-xl" aria-label={`继续观看 ${item.title}${episode ? `，${episode}` : ''}，${time}`}>
                <div className="relative aspect-video overflow-hidden rounded-xl bg-chip">
                  <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-muted"><Icon name="clock" className="h-8 w-8" /></div>
                  <SmartImage url={item.pic} mode={mode} customProxy={customProxy} alt="" className="relative h-full w-full object-cover object-[center_35%] transition-transform duration-200 motion-reduce:transition-none motion-safe:group-hover:scale-[1.025]" />
                  <div role="progressbar" aria-label={`${item.title}观看进度`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
                    className="absolute inset-x-0 bottom-0 h-1 bg-black/60"><div className="h-full bg-accent" style={{ width: `${percent}%` }} /></div>
                </div>
                <h3 className="mt-3 truncate text-sm sm:text-base font-medium">{item.title}</h3>
                <p className="mt-1 text-xs sm:text-sm text-muted">{[episode, time].filter(Boolean).join(' · ')}</p>
              </Link>
            </div>
          );
        })}
      </HorizontalShelf>
    </section>
  );
}
