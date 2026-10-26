import { normalizeTitle } from './cms-parser';
import type { DoubanItem, SearchResultItem, SourceConfig, VideoDetail } from './types';

const UNAVAILABLE = /预告|先导|花絮|片花|解说|待上映|即将上映|未上映/;

/** 只接受同名正片；搜索有条目但详情没有播放地址也不能进入首页。 */
export async function hasRecommendationSource(
  item: DoubanItem,
  sources: SourceConfig[],
  search: () => Promise<{ list: SearchResultItem[] }>,
  detail: (id: string, source: SourceConfig) => Promise<VideoDetail>,
  signal: AbortSignal,
): Promise<boolean> {
  const { list } = await search();
  const matches = list.filter((entry) => normalizeTitle(entry.name) === normalizeTitle(item.title)
    && !UNAVAILABLE.test(`${entry.remarks || ''} ${entry.typeName || ''}`));
  for (const entry of matches) {
    signal.throwIfAborted();
    const source = sources.find((s) => s.key === entry.sourceKey && (!entry.sourceUrl || s.url === entry.sourceUrl));
    if (!source) continue;
    try {
      const data = await detail(entry.vodId, source);
      if (UNAVAILABLE.test(`${data.videoInfo.remarks || ''} ${data.videoInfo.typeName || ''}`)) continue;
      if (data.videoInfo.title && normalizeTitle(data.videoInfo.title) !== normalizeTitle(item.title)) continue;
      if (data.episodes.some((url) => /^https?:\/\//i.test(url))) return true;
    } catch (error) {
      signal.throwIfAborted();
      // 一个来源失效时继续查找其余同名来源。
      if (error instanceof Error && 'status' in error && error.status === 401) throw error;
    }
  }
  return false;
}
