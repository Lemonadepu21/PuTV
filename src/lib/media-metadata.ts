/** 只更新系统媒体卡片信息；浏览器继续处理原有播放控制。 */
export function bindMediaMetadata(title: string, covers: string[], baseUrl: string): () => void {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return () => {};
  const session = navigator.mediaSession;
  const previous = session.metadata;
  const metadata = new MediaMetadata({
    title,
    artist: 'PuTV',
    artwork: [{ src: new URL('/icons/icon-512.png', baseUrl).href, sizes: '512x512', type: 'image/png' }],
  });
  session.metadata = metadata;
  const image = new Image();
  image.referrerPolicy = 'no-referrer';
  let active = true;
  let index = 0;
  const next = () => {
    if (!active || session.metadata !== metadata) return;
    while (index < covers.length) {
      try {
        const url = new URL(covers[index++], baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
        image.src = url.href;
        return;
      } catch { /* 自定义模板无效时继续使用下一个地址。 */ }
    }
  };
  image.onload = () => {
    if (!active || session.metadata !== metadata) return;
    metadata.artwork = [{ src: image.src, sizes: `${image.naturalWidth}x${image.naturalHeight}` }];
  };
  image.onerror = next;
  next();
  return () => {
    active = false;
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    if (session.metadata === metadata) session.metadata = previous;
  };
}
