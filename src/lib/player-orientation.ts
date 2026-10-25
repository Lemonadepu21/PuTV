import type Artplayer from 'artplayer';
import { isBackKey } from './keyboard-navigation';

type OrientationLock = { lock?: (orientation: 'landscape') => Promise<void>; unlock?: () => void };
let lockOwner: symbol | undefined;

/** 原生锁屏失败则退出后进入网页全屏；CSS 旋转沿用 ArtPlayer 的 isRotate 手势语义。 */
export function bindPlayerOrientation(art: Artplayer, touch: boolean): () => void {
  const exitWeb = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !art.fullscreenWeb || !isBackKey(event) || document.querySelector('[aria-modal="true"]')) return;
    event.preventDefault();
    if (art.setting.show) art.setting.show = false;
    else art.fullscreenWeb = false;
  };
  window.addEventListener('keydown', exitWeb);
  if (!touch) return () => window.removeEventListener('keydown', exitWeb);
  const player = art.template.$player;
  const owner = Symbol('player-orientation');
  const orientation = screen.orientation as OrientationLock | undefined;
  let disposed = false;
  let revision = 0;
  let fallback = false;
  const portrait = () => document.documentElement.clientWidth < document.documentElement.clientHeight;
  const landscapeVideo = () => art.video.videoWidth > art.video.videoHeight;
  const unlock = () => {
    if (lockOwner !== owner) return;
    try { orientation?.unlock?.(); } catch { /* 浏览器可能不提供解锁。 */ }
    lockOwner = undefined;
  };
  const rotate = () => {
    const active = art.fullscreenWeb && portrait() && landscapeVideo();
    if (player.classList.contains('putv-landscape') === active) return;
    player.classList.toggle('putv-landscape', active);
    // ArtPlayer 内置旋转插件也会写入此运行时字段，进度条手势依赖它。
    Object.assign(art, { isRotate: active });
    art.emit('resize');
  };
  const web = () => { rotate(); };
  const native = async (active: boolean) => {
    const current = ++revision;
    if (!active) {
      unlock();
      if (fallback && !disposed) { fallback = false; art.fullscreenWeb = true; }
      return;
    }
    if (!portrait() || !landscapeVideo()) return;
    try {
      if (!orientation?.lock) throw new Error('orientation unavailable');
      lockOwner = owner;
      await orientation.lock('landscape');
      if (disposed || revision !== current || !art.fullscreen) unlock();
    } catch {
      if (disposed || revision !== current || !art.fullscreen) return;
      fallback = true;
      // 等待 fullscreen=false 事件后再进入网页全屏，避免两种全屏互相覆盖。
      art.fullscreen = false;
    }
  };
  const error = () => { if (!disposed && !art.fullscreen) art.fullscreenWeb = true; };
  art.on('fullscreen', native);
  art.on('fullscreenWeb', web);
  art.on('fullscreenError', error);
  art.on('video:loadedmetadata', rotate);
  window.addEventListener('resize', rotate);
  window.addEventListener('orientationchange', rotate);
  return () => {
    disposed = true;
    window.removeEventListener('keydown', exitWeb);
    revision++;
    fallback = false;
    art.off('fullscreen', native);
    art.off('fullscreenWeb', web);
    art.off('fullscreenError', error);
    art.off('video:loadedmetadata', rotate);
    window.removeEventListener('resize', rotate);
    window.removeEventListener('orientationchange', rotate);
    player.classList.remove('putv-landscape');
    Object.assign(art, { isRotate: false });
    unlock();
  };
}
