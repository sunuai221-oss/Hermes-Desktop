import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  House, MessageSquare, Database, Clock3, Puzzle,
  ShieldCheck, Settings, Sparkles,
  FileStack, Webhook, GitBranchPlus, Globe, BookOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem =
  | 'home' | 'chat' | 'sessions'
  | 'soul' | 'skills' | 'profiles'
  | 'config' | 'contextFiles'
  | 'automations' | 'extensions' | 'delegation'
  | 'platforms' | 'docs';

export type NavSection = {
  label: string;
  items: NavEntry[];
};

export type NavEntry = {
  id: NavItem;
  icon: LucideIcon;
  label: string;
  title: string;  // displayed in Header
  path: string;
};

// ── Single source of truth ──────────────────────────────────────

export const navSections: NavSection[] = [
  {
    label: 'Core',
    items: [
      { id: 'home',          icon: House,           label: 'Home',           title: 'Home',           path: '/' },
      { id: 'chat',          icon: MessageSquare,   label: 'Chat',           title: 'Chat',           path: '/chat' },
      { id: 'sessions',      icon: Database,        label: 'Sessions',       title: 'Sessions',       path: '/sessions' },
    ],
  },
  {
    label: 'Agent',
    items: [
      { id: 'soul',          icon: Sparkles,        label: 'Agent Studio',   title: 'Agent Studio',   path: '/identity' },
      { id: 'skills',        icon: Puzzle,          label: 'Skills',         title: 'Skills',         path: '/skills' },
      { id: 'profiles',      icon: ShieldCheck,     label: 'Profiles',       title: 'Profiles',       path: '/profiles' },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { id: 'config',        icon: Settings,        label: 'Runtime',        title: 'Runtime',        path: '/config' },
      { id: 'contextFiles',  icon: FileStack,       label: 'Context Files',  title: 'Context Files',  path: '/context-files' },
    ],
  },
  {
    label: 'Automation',
    items: [
      { id: 'automations',   icon: Clock3,          label: 'Automations',    title: 'Automations',    path: '/automations' },
      { id: 'extensions',    icon: Webhook,         label: 'Extensions',     title: 'Extensions',     path: '/extensions' },
      { id: 'delegation',    icon: GitBranchPlus,   label: 'Delegation',     title: 'Delegation',     path: '/delegation' },
    ],
  },
  {
    label: 'External',
    items: [
      { id: 'platforms',     icon: Globe,           label: 'Platforms',      title: 'Platforms',      path: '/platforms' },
    ],
  },
];

const footerItems: NavEntry[] = [
  { id: 'docs', icon: BookOpen, label: 'Documentation', title: 'Documentation', path: '/docs' },
];

// ── Derived lookups ─────────────────────────────────────────────

const allItems = [...navSections.flatMap(s => s.items), ...footerItems];

export const navPathMap: Record<NavItem, string> = Object.fromEntries(
  allItems.map(item => [item.id, item.path]),
) as Record<NavItem, string>;

const pathToNav = new Map<string, NavItem>(
  allItems.map(item => [item.path, item.id]),
);

const navToEntry = new Map<NavItem, NavEntry>(
  allItems.map(item => [item.id, item]),
);

// ── Hook ────────────────────────────────────────────────────────

export function useNavigation() {
  const location = useLocation();

  const activeNav = useMemo<NavItem>(() => {
    return pathToNav.get(location.pathname) || 'home';
  }, [location.pathname]);

  const activeEntry = navToEntry.get(activeNav)!;

  return {
    navSections,
    footerItems,
    allItems,
    navPathMap,
    activeNav,
    activeEntry,
    pageTitle: activeEntry.title,
    pathFor: (nav: NavItem) => navPathMap[nav],
  };
}
