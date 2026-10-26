'use client';

import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useAuth } from './auth';
import { api } from '@/lib/client-api';
import { hasRecommendationSource } from '@/lib/recommendation-availability';
import { useAppStore, resolveSource, isSourceDisabled, isInDisabledSubscription } from '@/lib/store';
import { validateSourceUrl } from '@/lib/utils';
import { RecommendationLayout } from './recommendation-layout';

export function HomeRecommendations(props: ComponentProps<typeof RecommendationLayout>) {
  const { verified, account, profile } = useAuth();
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const sources = useMemo(() => Array.from(new Set(selectedKeys))
    .filter((key) => !isSourceDisabled({ sourceHealth }, key) && !isInDisabledSubscription({ subscriptions }, key))
    .flatMap((key) => {
      const source = resolveSource({ customAPIs, envSources }, key);
      return source && validateSourceUrl(source.url) ? [source] : [];
    }), [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);
  const batchKey = JSON.stringify([account?.id, profile?.id, sources, yellowFilter, props.items]);
  const [batch, setBatch] = useState({ key: batchKey, count: 3 });
  const count = batch.key === batchKey ? batch.count : 3;
  const queries = useQueries({ queries: props.items.map((item, index) => ({
    queryKey: ['home-source', account?.id, profile?.id, sources, yellowFilter, item.title],
    queryFn: ({ signal }: { signal: AbortSignal }) => hasRecommendationSource(item, sources,
      () => api.search(item.title.slice(0, 100), sources, yellowFilter, { signal }),
      (id, source) => api.detail(id, source, signal), signal),
    enabled: verified && sources.length > 0 && index < count,
    staleTime: 60_000,
    retry: false,
  })) });
  const settled = queries.slice(0, count).every((query) => !query.isPending);
  useEffect(() => {
    if (settled && count < props.items.length) setBatch({ key: batchKey, count: Math.min(count + 3, props.items.length) });
  }, [settled, count, batchKey, props.items.length]);
  const items = props.items.filter((_, index) => queries[index]?.data === true);
  const checking = verified && sources.length > 0 && queries.some((query) => query.isPending);
  return <RecommendationLayout {...props} items={items} loading={props.loading || (checking && items.length === 0)}
    emptyText={sources.length ? '当前片单暂无可用片源' : '请先在设置中添加并启用点播源'} />;
}
