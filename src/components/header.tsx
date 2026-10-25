'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { AccountEntry } from './account-screens';
import { SearchDialog } from './search-dialog';
import { BROWSE_CATEGORIES, type BrowseCategory } from '@/lib/browse-categories';
import { cn } from '@/lib/utils';

/** 顶部导航保留原入口，滚动后使用高不透明度背景。 */
export function Header({ immersive = false, category, searchQuery, onSearch }: {
  immersive?: boolean;
  category?: BrowseCategory;
  searchQuery?: string;
  onSearch?: (query: string) => boolean;
}) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    document.body.classList.add('has-mobile-nav');
    return () => document.body.classList.remove('has-mobile-nav');
  }, []);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 16);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'k' || event.isComposing) return;
      event.preventDefault();
      if (document.querySelector('[aria-modal="true"]')) return;
      setSearchOpen(true);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-40 border-b transition-colors duration-200',
          scrolled ? 'border-line bg-page/95' : immersive ? 'cinema-header border-transparent bg-transparent' : 'border-transparent bg-page'
        )}
      >
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 lg:px-10 h-16 flex items-center gap-2 sm:gap-4 lg:gap-8">
          <Link href="/" aria-label="PuTV 首页" className="flex items-center gap-2.5 shrink-0 rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="w-8 h-8" />
            <span className="hidden sm:inline text-xl font-semibold tracking-tight">PuTV</span>
          </Link>

          <nav aria-label="主导航" className="hidden lg:flex items-center gap-1 self-stretch">
            <HeaderLink href="/" active={pathname === '/' && !category && !searchQuery}>首页</HeaderLink>
            {BROWSE_CATEGORIES.map((entry) => (
              <HeaderLink key={entry.id} href={`/?category=${entry.id}`} active={pathname === '/' && category === entry.id && !searchQuery}>{entry.label}</HeaderLink>
            ))}
            <HeaderLink href="/live" active={pathname === '/live'}>直播</HeaderLink>
            <HeaderLink href="/about" active={pathname === '/about'}>关于</HeaderLink>
          </nav>

          <nav aria-label="工具栏" className="flex items-center gap-0.5 sm:gap-1 ml-auto">
            <IconButton label="搜索影片" onClick={() => setSearchOpen(true)}><Icon name="search" /></IconButton>
            <ThemeToggle />
            <IconButton label="观看历史" onClick={() => setHistoryOpen(true)}>
              <Icon name="clock" />
            </IconButton>
            <span className="inline-flex">
              <IconButton label="下载管理" onClick={requestShowDownloadManager}>
                <Icon name="download" />
              </IconButton>
            </span>
            <IconButton label="设置" onClick={() => setSettingsOpen(true)}>
              <Icon name="gear" />
            </IconButton>
            <AccountEntry />
          </nav>
        </div>
      </header>
      <nav aria-label="移动页面导航" className="mobile-page-nav lg:hidden">
          <HeaderLink href="/" active={pathname === '/' && !category && !searchQuery}>首页</HeaderLink>
          {BROWSE_CATEGORIES.map((entry) => (
            <HeaderLink key={entry.id} href={`/?category=${entry.id}`} active={pathname === '/' && category === entry.id && !searchQuery}>{entry.label}</HeaderLink>
          ))}
          <HeaderLink href="/live" active={pathname === '/live'}>直播</HeaderLink>
          <HeaderLink href="/about" active={pathname === '/about'}>关于</HeaderLink>
      </nav>

      {searchOpen && <SearchDialog onClose={closeSearch} onSearch={onSearch} initialQuery={searchQuery} />}
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
        'inline-flex shrink-0 h-full min-h-10 items-center px-2.5 lg:px-3 text-sm font-medium border-b-2 transition-colors',
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
