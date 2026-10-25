import { describe, expect, it } from 'vitest';
import { continueWatching } from './continue-watching';
import { contentKey, episodeKey, type WatchHistory, type WatchProgress } from './watch-types';

function history(overrides: Partial<WatchHistory> = {}): WatchHistory {
  return { id: contentKey('source', 'film', 'https://cms.example/api'), sourceKey: 'source', sourceUrl: 'https://cms.example/api', vodId: 'film', title: '影片', episodeIndex: 0, totalEpisodes: 1, playbackPosition: 30, duration: 120, timestamp: 100, ...overrides };
}
function progress(index: number, overrides: Partial<WatchProgress> = {}): WatchProgress {
  return { key: episodeKey('source', 'film', index, 'https://cms.example/api'), position: 30, duration: 120, updatedAt: 200, ...overrides };
}

describe('首页继续观看', () => {
  it('读取分集进度，历史摘要为零也可以恢复', () => {
    const [item] = continueWatching([history({ playbackPosition: 0, duration: 0 })], [progress(0, { position: 45 })]);
    expect(item.playbackPosition).toBe(45);
    expect(item.duration).toBe(120);
    expect(item.timestamp).toBe(200);
  });
  it('未实际观看、已看完、到片尾的电影不出现', () => {
    for (const entry of [history({ playbackPosition: 0 }), history({ playbackPosition: 10 }), history({ completed: true }), history({ playbackPosition: 118 }), history({ playbackPosition: 125 })]) {
      expect(continueWatching([entry], [])).toEqual([]);
    }
    expect(continueWatching([history()], [progress(0, { completed: true })])).toEqual([]);
  });
  it('看完一集进入下一集，保留下一集独立进度', () => {
    const [item] = continueWatching([history({ totalEpisodes: 3 })], [progress(0, { completed: true }), progress(1, { position: 55 })]);
    expect(item.episodeIndex).toBe(1);
    expect(item.playbackPosition).toBe(55);
  });
  it('跳过连续完成的集数，下一集未开始仍提供入口', () => {
    const [item] = continueWatching([history({ totalEpisodes: 3 })], [progress(0, { completed: true }), progress(1, { position: 119 })]);
    expect(item.episodeIndex).toBe(2);
    expect(item.playbackPosition).toBe(0);
    expect(item.duration).toBe(0);
  });
  it('最后一集完成后隐藏，未知时长不虚构完成状态', () => {
    expect(continueWatching([history({ episodeIndex: 2, totalEpisodes: 3 })], [progress(2, { completed: true })])).toEqual([]);
    expect(continueWatching([history({ duration: 0 })], [])).toHaveLength(1);
  });
  it('分集重看进度覆盖历史中的旧片尾摘要', () => {
    const [item] = continueWatching([history({ playbackPosition: 120 })], [progress(0, { position: 40 })]);
    expect(item.episodeIndex).toBe(0);
    expect(item.playbackPosition).toBe(40);
  });
  it('同名同短 ID 的不同源互不混用', () => {
    const other = history({ id: 'other', sourceUrl: 'https://other.example/api', playbackPosition: 60 });
    const items = continueWatching([history(), other], [progress(0, { completed: true })]);
    expect(items.map((i) => i.sourceUrl)).toEqual(['https://other.example/api']);
    expect(items[0].playbackPosition).toBe(60);
  });
  it('保留旧分集 key 兼容，孤立进度不生成虚构影片', () => {
    expect(continueWatching([history()], [progress(0, { key: 'source_film_0', position: 50 })])[0].playbackPosition).toBe(50);
    expect(continueWatching([], [progress(0)])).toEqual([]);
  });
  it('按最近观看排序并限制十二项，不修改输入', () => {
    const records = Array.from({ length: 15 }, (_, i) => history({ id: String(i), vodId: String(i), timestamp: i }));
    const items = continueWatching(records, [progress(0, { key: episodeKey('source', '0', 0, 'https://cms.example/api'), updatedAt: 999 })]);
    expect(items).toHaveLength(12);
    expect(items.slice(0, 3).map((i) => i.id)).toEqual(['0', '14', '13']);
    expect(records[0].timestamp).toBe(0);
  });
  it('异常旧记录不产生无效卡片或无限循环', () => {
    for (const overrides of [{ episodeIndex: -1 }, { episodeIndex: 1.2 }, { totalEpisodes: Infinity }, { duration: NaN }, { playbackPosition: -5 }]) {
      expect(continueWatching([history(overrides)], [])).toEqual([]);
    }
  });
});
