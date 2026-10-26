import { describe, expect, it } from 'vitest';
import { watchTitle } from './watch-title';

describe('播放页标题', () => {
  it('剧集显示当前集，换集和顺序倒排仍使用实际播放索引', () => {
    expect(watchTitle('庆余年', 2, 36, '国产剧')).toBe('庆余年 第3集');
    expect(watchTitle('庆余年', 35, 36, '国产剧')).toBe('庆余年 第36集');
  });
  it('电影不显示集数，包括多个语言版本或上下部地址', () => {
    for (const type of ['电影', '科幻片', '动画电影', '剧情片', 'Movie'])
      expect(watchTitle('流浪地球', 1, 2, type)).toBe('流浪地球');
  });
  it('仅更新一集的剧集、动漫、综艺也显示集数', () => {
    for (const type of ['国产剧', '日韩动漫', '综艺', 'Series'])
      expect(watchTitle('新番', 0, 1, type)).toBe('新番 第1集');
  });
  it('缺少类型和直连链接不编造集数，多集内容可以兜底', () => {
    expect(watchTitle('影片', 0, 0)).toBe('影片');
    expect(watchTitle('影片', 0, 1)).toBe('影片');
    expect(watchTitle('剧集', 1, 8)).toBe('剧集 第2集');
  });
  it('纪录片、动画片的多集内容不被误判为单部电影', () => {
    expect(watchTitle('地球', 1, 6, '纪录片')).toBe('地球 第2集');
    expect(watchTitle('动画', 2, 12, '动画片')).toBe('动画 第3集');
  });
  it('空标题保留站点名，异常索引不会出现负数或 NaN', () => {
    expect(watchTitle('', 0, 0)).toBe('PuTV');
    expect(watchTitle('未知视频', 0, 0)).toBe('PuTV');
    expect(watchTitle(' 剧名 ', NaN, 10)).toBe('剧名 第1集');
    expect(watchTitle('剧名', -1, 10)).toBe('剧名 第1集');
  });
});
