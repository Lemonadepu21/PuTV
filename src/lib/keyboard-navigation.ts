type Rect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
const DIRECTIONS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function spatialTarget(origin: Rect, candidates: Rect[], key: string): number {
  if (!DIRECTIONS.includes(key)) return -1;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const forward = key === 'ArrowRight' || key === 'ArrowDown';
  const x = (origin.left + origin.right) / 2;
  const y = (origin.top + origin.bottom) / 2;
  let best = -1;
  let score = Infinity;
  candidates.forEach((rect, index) => {
    const dx = (rect.left + rect.right) / 2 - x;
    const dy = (rect.top + rect.bottom) / 2 - y;
    const main = horizontal ? dx : dy;
    if ((forward ? main : -main) <= 1) return;
    const cross = horizontal ? Math.abs(dy) : Math.abs(dx);
    const aligned = horizontal ? rect.bottom > origin.top && rect.top < origin.bottom
      : rect.right > origin.left && rect.left < origin.right;
    const distance = Math.abs(main) + cross * 2 + (aligned ? 0 : 10000);
    if (distance < score) { score = distance; best = index; }
  });
  return best;
}

export function isBackKey(event: Pick<KeyboardEvent, 'key' | 'target'>): boolean {
  if (event.key === 'Escape' || event.key === 'BrowserBack' || event.key === 'GoBack') return true;
  return event.key === 'Backspace' && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

/** 只在页面内处理方向键；输入、播放器与已处理的组件按键继续使用原逻辑。 */
export function enableDirectionalNavigation(): () => void {
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || !DIRECTIONS.includes(event.key)) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .art-video-player, [role="slider"]')) return;
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).filter((node) => node.getClientRects().length > 0);
    const scope = dialogs.at(-1) ?? document.querySelector<HTMLElement>('.art-fullscreen, .art-fullscreen-web') ?? document;
    const candidates = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) =>
      node !== active && node.tabIndex >= 0 && node.getClientRects().length > 0 && !node.closest('[aria-hidden="true"], [inert]') && getComputedStyle(node).visibility !== 'hidden'
    );
    const index = !active || active === document.body ? 0 : spatialTarget(active.getBoundingClientRect(), candidates.map((node) => node.getBoundingClientRect()), event.key);
    const next = candidates[index];
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  window.addEventListener('keydown', keydown);
  return () => window.removeEventListener('keydown', keydown);
}
