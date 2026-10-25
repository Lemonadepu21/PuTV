'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { useFocusTrap } from './use-focus-trap';
import { Icon } from './icon';
import { cn } from '@/lib/utils';

export function SearchDialog({ onClose, onSearch, initialQuery = '' }: {
  onClose: () => void;
  onSearch?: (query: string) => boolean;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState(initialQuery);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useSearchHistory(input);
  useFocusTrap(true, panelRef);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', keydown);
    };
  }, [onClose]);

  const submit = (text: string) => {
    const query = text.trim().slice(0, 100);
    if (!query) { inputRef.current?.focus(); return; }
    history.close();
    if (onSearch) {
      if (!onSearch(query)) return;
    } else {
      router.push(`/?s=${encodeURIComponent(query)}`, { scroll: false });
      history.record(query);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[max(1rem,12vh)]">
      <div aria-hidden="true" className="absolute inset-0 bg-black/65" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="search-dialog-title" tabIndex={-1} className="relative w-full max-w-2xl rounded-2xl border border-line bg-surface p-4 sm:p-6 outline-none">
        <h2 id="search-dialog-title" className="mb-5 pr-10 text-lg font-semibold">搜索影片</h2>
        <div ref={history.containerRef} className="relative">
          <form onSubmit={(event) => { event.preventDefault(); submit(input); }}>
            <div className={cn('flex min-h-12 items-stretch border pl-4', history.visible
              ? 'rounded-t-xl border-accent border-b-line bg-surface-raised'
              : 'rounded-xl border-line bg-chip focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40')}>
              <input
                ref={inputRef} className="min-w-0 flex-1 bg-transparent pr-2 text-sm text-content placeholder:text-faint focus:outline-none"
                placeholder="输入影片名称..." aria-label="搜索影片" value={input} maxLength={100}
                onChange={(event) => { setInput(event.target.value); history.resetActive(); }}
                onFocus={history.onFocus}
                onKeyDown={(event) => { if (!event.nativeEvent.isComposing) history.onKeyDown(event, submit); }}
                role="combobox" aria-expanded={history.visible} aria-controls="search-dialog-history" aria-autocomplete="list"
                aria-activedescendant={history.visible && history.activeIndex >= 0 ? `search-dialog-history-${history.activeIndex}` : undefined}
              />
              {input && <button type="button" aria-label="清空输入" className="my-auto mr-1 rounded-md p-1.5 text-muted hover:bg-hover hover:text-content" onClick={() => { setInput(''); history.resetActive(); inputRef.current?.focus(); }}><Icon name="close" className="h-4 w-4" /></button>}
              <button type="submit" className={cn('btn-primary shrink-0 !rounded-l-none px-4', history.visible ? '!rounded-tr-xl !rounded-br-none' : '!rounded-r-xl')}><Icon name="search" className="h-4 w-4" />搜索</button>
            </div>
          </form>
          {history.visible && <SearchHistoryDropdown id="search-dialog-history" matches={history.matches} activeIndex={history.activeIndex} onPick={submit} onRemove={history.remove} onClearAll={history.clearAll} />}
        </div>
        <button type="button" aria-label="关闭搜索" className="absolute right-3 top-3 rounded-lg p-2 text-muted hover:bg-hover hover:text-content sm:right-5 sm:top-5" onClick={onClose}><Icon name="close" className="h-5 w-5" /></button>
      </div>
    </div>
  );
}
