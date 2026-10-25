export const BROWSE_CATEGORIES = [
  { id: 'movie', label: '电影' },
  { id: 'tv', label: '剧集' },
  { id: 'anime', label: '动漫' },
] as const;
export type BrowseCategory = typeof BROWSE_CATEGORIES[number]['id'];
