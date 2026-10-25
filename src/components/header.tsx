'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { cn } from '@/lib/utils';

/** 顶部导航保留原入口，滚动后使用高不透明度背景。 */
export function Header({ showSearch = false, immersive = false }: { showSearch?: boolean; immersive?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 16);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  // 与首页搜索框共用同一套「最近搜索」下拉逻辑
  const searchHistory = useSearchHistory(query);

  const submitSearch = (text: string) => {
    const q = text.trim().slice(0, 100);
    if (!q) return;
    searchHistory.close();
    router.push(`/?s=${encodeURIComponent(q)}`, { scroll: false });
    // 顶栏搜索一并写入最近搜索（此前只有首页会记录）
    searchHistory.record(q);
  };

  const pickHistory = (text: string) => {
    setQuery(text);
    submitSearch(text);
  };

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-40 border-b transition-colors duration-200',
          scrolled ? 'border-line bg-page/95' : immersive ? 'cinema-header border-transparent bg-transparent' : 'border-transparent bg-page'
        )}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center gap-4 lg:gap-8">
          <Link href="/" aria-label="PuTv 首页" className="flex items-center gap-2.5 shrink-0 rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="w-8 h-8" />
            <span className="text-xl font-semibold tracking-tight">PuTv</span>
          </Link>

          <nav aria-label="主导航" className="hidden md:flex items-center gap-1 self-stretch">
            <HeaderLink href="/" active={pathname === '/'}>首页</HeaderLink>
            <HeaderLink href="/live" active={pathname === '/live'}>直播</HeaderLink>
            <HeaderLink href="/about" active={pathname === '/about'}>关于</HeaderLink>
          </nav>

          {showSearch && (
            <form
              className="flex-1 max-w-sm hidden xl:block"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(query);
              }}
            >
              <div ref={searchHistory.containerRef} className="relative">
                <input
                  className={cn(
                    'input w-full h-9',
                    // 展开时：上圆角与外框沿用聚焦样式，底边改为内部分隔线，与下拉拼成同一面板
                    searchHistory.visible &&
                      'rounded-b-none border-accent border-b-line bg-surface-raised focus-visible:ring-0'
                  )}
                  aria-label="搜索影片"
                  placeholder="搜索影片..."
                  value={query}
                  maxLength={100}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    searchHistory.resetActive();
                  }}
                  onFocus={searchHistory.onFocus}
                  onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                  role="combobox"
                  aria-expanded={searchHistory.visible}
                  aria-controls="header-search-history"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    searchHistory.visible && searchHistory.activeIndex >= 0
                      ? `header-search-history-${searchHistory.activeIndex}`
                      : undefined
                  }
                />
                {searchHistory.visible && (
                  <SearchHistoryDropdown
                    id="header-search-history"
                    matches={searchHistory.matches}
                    activeIndex={searchHistory.activeIndex}
                    onPick={pickHistory}
                    onRemove={searchHistory.remove}
                    onClearAll={searchHistory.clearAll}
                  />
                )}
              </div>
            </form>
          )}

          <nav aria-label="工具栏" className="flex items-center gap-0.5 sm:gap-1 ml-auto">
            <Link href="/#search" aria-label="搜索影片" title="搜索影片" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:text-content hover:bg-hover transition-colors">
              <Icon name="search" />
            </Link>
            <ThemeToggle />
            <IconButton label="观看历史" onClick={() => setHistoryOpen(true)}>
              <Icon name="clock" />
            </IconButton>
            <span className="hidden sm:inline-flex">
              <IconButton label="下载管理" onClick={requestShowDownloadManager}>
                <Icon name="download" />
              </IconButton>
            </span>
            <IconButton label="设置" onClick={() => setSettingsOpen(true)}>
              <Icon name="gear" />
            </IconButton>
          </nav>
        </div>
        <nav aria-label="移动页面导航" className="md:hidden flex items-center justify-center gap-5 border-t border-line/60 px-4">
          <HeaderLink href="/" active={pathname === '/'}>首页</HeaderLink>
          <HeaderLink href="/live" active={pathname === '/live'}>直播</HeaderLink>
          <button type="button" onClick={requestShowDownloadManager} className="sm:hidden min-h-10 px-2 text-sm text-muted hover:text-content">下载</button>
          <HeaderLink href="/about" active={pathname === '/about'}>关于</HeaderLink>
        </nav>
      </header>

      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function HeaderLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-full min-h-10 items-center px-2.5 lg:px-3 text-sm font-medium border-b-2 transition-colors',
        active ? 'text-content border-accent' : 'text-muted border-transparent hover:text-content'
      )}
    >
      {children}
    </Link>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:text-content hover:bg-hover transition-colors"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
