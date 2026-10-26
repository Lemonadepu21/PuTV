/** 类型明确时优先按类型判断；缺少类型时用分集数量兜底。 */
export function watchTitle(title: string, index: number, total: number, typeName = ''): string {
  const name = title.trim();
  if (!name || name === '未知视频') return 'PuTV';
  const type = typeName.trim();
  const movie = /电影|movie|film/i.test(type) || (/片$/.test(type) && !/纪录|记录|动画/.test(type));
  const series = !movie && (total > 1 || /剧|动漫|综艺|番|series/i.test(type));
  const episode = Number.isFinite(index) ? Math.max(0, Math.floor(index)) + 1 : 1;
  return series ? `${name} 第${episode}集` : name;
}
