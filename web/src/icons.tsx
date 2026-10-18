// One stroke-icon set. <Icon name="home"/> is 24px with a 1.8 stroke (Design D). Every path lives in PATHS, drawn on a 24x24 grid.
// ICONS (below) keeps the old `ICONS.xyz` call sites working; it is generated from the same PATHS, so the whole app shares one look.
const PATHS = {
  // Design D navigation + shell
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  marketing: 'M3 10v4a1 1 0 0 0 1 1h3l9 4V5L7 9H4a1 1 0 0 0-1 1zM19.5 9a4 4 0 0 1 0 6',
  crm: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  ads: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  collabs: 'M9 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM15 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  analytics: 'M6 20v-8M12 20V5M18 20v-11',
  posts: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z',
  alert: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7v6M12 16.5v.5',
  close: 'M6 6l12 12M18 6L6 18',
  chat: 'M12 3a9 9 0 1 0 4.3 16.9L21 21l-1.2-4.6A9 9 0 0 0 12 3z',
  plusSquare: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 8v8M8 12h8',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  trendUp: 'M7 17L17 7M8 7h9v9',
  trendDown: 'M7 7l10 10M17 8v9H8',
  // Existing icons (names unchanged: Assistant, DashboardCards and the sidebar's "More" group look these up)
  menu: 'M3 6h18M3 12h18M3 18h18',
  mic: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  Dashboard: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  Statistics: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  start: 'M12 5v14M5 12h14',
  collab: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  mention: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9',
  community: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  giveaway: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  swap: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  content: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  consistency: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  hashtags: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  Competitors: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  'Content AI': 'M12 5v14M5 12h14',
  Scheduling: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  'Finance & Capital': 'M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2',
  Settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2',
  Roadmap: 'M9 20l-6-3V4l6 3 6-3 6 3v13l-6-3zM9 7v13M15 4v13',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  clip: 'M21 11l-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3',
  chevDown: 'M6 9l6 6 6-6',
  chevUp: 'M18 15l-6-6-6 6',
} as const;

export type IconName = keyof typeof PATHS;

// size defaults to 24 and sw (stroke width) to 1.8. Decorative by default; pass `title` when the icon is the only label.
export function Icon({name, size = 24, sw = 1.8, title}: {name: IconName; size?: number; sw?: number; title?: string}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
    <path d={PATHS[name]}/></svg>;
}

export const ICONS: Record<string, JSX.Element> = Object.fromEntries(
  (Object.keys(PATHS) as IconName[]).map(k => [k, <Icon key={k} name={k}/>]));
