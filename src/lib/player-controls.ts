import Artplayer from 'artplayer';
import { ART_DEFAULT_CONTROL_HIDE_MS, DESKTOP_CONTROL_HIDE_MS, TOUCH_CONTROL_HIDE_MS } from './control-hide';

/** 共用同一计时器，避免库计时与触屏合成鼠标事件导致控件闪隐。 */
export function bindPlayerControls(art: Artplayer, touch: boolean): () => void {
  Artplayer.CONTROL_HIDE_TIME = Number.MAX_SAFE_INTEGER;
  const player = art.template.$player;
  player.tabIndex = 0;
  player.setAttribute('aria-label', 'PuTV 播放器');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  let seeking = false;
  let keyboard = false;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const busy = () => held || seeking || art.setting.show || !art.playing ||
    (keyboard && player.contains(document.activeElement) && Boolean(document.activeElement?.closest('.art-controls, .art-settings')));
  const schedule = () => {
    clear();
    if (!art.controls.show || busy()) return;
    timer = setTimeout(() => {
      if (!busy()) art.controls.show = false;
    }, touch ? TOUCH_CONTROL_HIDE_MS : DESKTOP_CONTROL_HIDE_MS);
  };
  const show = () => { art.controls.show = true; schedule(); };
  const control = (visible: boolean) => { if (visible) schedule(); else clear(); };
  const down = () => { keyboard = false; held = true; clear(); };
  const up = () => { held = false; schedule(); };
  const move = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && !touch) show();
  };
  const keydown = (event: KeyboardEvent) => {
    keyboard = true;
    const target = event.target as HTMLElement | null;
    if (['Enter', ' ', 'MediaPlayPause'].includes(event.key) && !target?.closest?.('.art-controls, .art-settings, button, input, select, textarea')) {
      event.preventDefault();
      art.toggle();
    }
    show();
  };
  const startSeek = () => { seeking = true; show(); };
  const endSeek = () => { seeking = false; schedule(); };
  const setting = () => { if (art.setting.show) show(); else schedule(); };
  player.addEventListener('pointerdown', down);
  player.addEventListener('pointermove', move);
  player.addEventListener('keydown', keydown);
  player.addEventListener('focusout', schedule);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
  window.addEventListener('blur', up);
  art.on('control', control);
  art.on('setting', setting);
  art.on('video:playing', show);
  art.on('video:pause', show);
  art.on('video:ended', show);
  art.on('video:seeking', startSeek);
  art.on('video:seeked', endSeek);
  show();
  return () => {
    clear();
    player.removeEventListener('pointerdown', down);
    player.removeEventListener('pointermove', move);
    player.removeEventListener('keydown', keydown);
    player.removeEventListener('focusout', schedule);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    window.removeEventListener('blur', up);
    art.off('control', control);
    art.off('setting', setting);
    art.off('video:playing', show);
    art.off('video:pause', show);
    art.off('video:ended', show);
    art.off('video:seeking', startSeek);
    art.off('video:seeked', endSeek);
    Artplayer.CONTROL_HIDE_TIME = ART_DEFAULT_CONTROL_HIDE_MS;
  };
}
