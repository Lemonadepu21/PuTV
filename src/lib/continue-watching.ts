import { episodeKey, type WatchHistory, type WatchProgress } from './watch-types';

/** 分集进度比历史摘要更及时；续播门槛与播放器的恢复条件一致。 */
export function continueWatching(histories: WatchHistory[], progress: WatchProgress[]): WatchHistory[] {
  const byEpisode = new Map(progress.map((item) => [item.key, item]));
  return histories.flatMap((history): WatchHistory[] => {
    if (history.completed || !Number.isInteger(history.episodeIndex) || history.episodeIndex < 0 || !Number.isInteger(history.totalEpisodes) || history.episodeIndex >= history.totalEpisodes) return [];
    let timestamp = history.timestamp;
    for (let index = history.episodeIndex; index < history.totalEpisodes; index++) {
      const saved = byEpisode.get(episodeKey(history.sourceKey, history.vodId, index, history.sourceUrl))
        ?? byEpisode.get(`${history.sourceKey}_${history.vodId}_${index}`);
      const position = saved?.position ?? (index === history.episodeIndex ? history.playbackPosition : 0);
      const duration = saved?.duration ?? (index === history.episodeIndex ? history.duration : 0);
      if (!Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration < 0) return [];
      timestamp = Math.max(timestamp, saved?.updatedAt ?? 0);
      if (saved?.completed || (duration > 0 && position >= duration - 2)) continue;
      // 下一集尚未开始也提供入口；刚打开但未实际观看的影片不占首页。
      if (index === history.episodeIndex && position <= 10) return [];
      return [{ ...history, episodeIndex: index, playbackPosition: position, duration, timestamp }];
    }
    return [];
  }).sort((a, b) => b.timestamp - a.timestamp).slice(0, 12);
}
