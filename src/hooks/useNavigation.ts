import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  House, MessageSquare, Database, Clock3, Puzzle,
  ShieldCheck, Settings, Sparkles,
  FileStack, Webhook, Globe, BookOpen, Kanban, GitBranchPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem =
  | 'home' | 'chat' | 'companions' | 'sessions'
  | 'workspaces' | 'templates' | 'kanban'
  | 'identity' | 'config' | 'skills' | 'profiles'
  | 'automations' | 'extensions'
  | 'platforms' | 'docs'
  | 'contextFiles';

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

// ── Advanced items (referenced in navSections) ─────────────
const advancedItems: NavEntry[] = [
  { id: 'contextFiles', icon: FileStack, label: 'Context Files', title: 'Context Files', path: '/context-files' },
  { id: 'extensions', icon: Webhook, label: 'Extensions', title: 'Extensions', path: '/extensions' },
];

// ── Single source of truth — 7 sections ─────────────────────────
// COUCHE 1: IDENTITE (Agent)    → "Qui suis-je ?"
// COUCHE 2: COMPOSITION (Workspaces) → "Qui travaille et comment ?"
// COUCHE 3: ENVIRONNEMENT (Home, Chat, Profiles, System) → "Où et avec quoi ?"

export const navSections: NavSection[] = [
  {
    label: 'Core',
    items: [
      { id: 'chat',          icon: MessageSquare,   label: 'Chat',           title: 'Chat',           path: '/chat' },
      { id: 'home',          icon: House,           label: 'Home',           title: 'Home',           path: '/home' },
      { id: 'companions',    icon: Sparkles,        label: 'Companions',     title: 'Companions',     path: '/companions' },
    ],
  },
  {
    label: 'Studio',
    items: [
      { id: 'templates',     icon: FileStack,       label: 'Templates',      title: 'Templates',      path: '/templates' },
      { id: 'workspaces',    icon: GitBranchPlus,   label: 'Workspaces',     title: 'Workspaces',     path: '/workspaces' },
      { id: 'kanban',        icon: Kanban,          label: 'Kanban',         title: 'Kanban',         path: '/kanban' },
    ],
  },
  {
    label: 'Identity',
    items: [
      { id: 'identity',      icon: Sparkles,        label: 'Identity',       title: 'Identity',       path: '/identity' },
      { id: 'config',        icon: Settings,        label: 'Config',         title: 'Config',         path: '/config' },
    ],
  },
  {
    label: 'Profiles',
    items: [
      { id: 'profiles',      icon: ShieldCheck,     label: 'Profiles',       title: 'Profiles',       path: '/profiles' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'sessions',      icon: Database,        label: 'Sessions',       title: 'Sessions',       path: '/sessions' },
      { id: 'skills',        icon: Puzzle,          label: 'Skills',         title: 'Skills',         path: '/skills' },
      { id: 'automations',   icon: Clock3,          label: 'Automations',    title: 'Automations',    path: '/automations' },
      { id: 'platforms',     icon: Globe,           label: 'Platforms',      title: 'Platforms',      path: '/platforms' },
    ],
  },
  {
    label: 'Advanced',
    items: advancedItems,
  },
];

const footerItems: NavEntry[] = [
  { id: 'docs', icon: BookOpen, label: 'Documentation', title: 'Documentation', path: '/docs' },
];

// ── Derived lookups ─────────────────────────────────────────────

const allItems = [...navSections.flatMap(s => s.items), ...footerItems, ...advancedItems];

export const navPathMap: Record<NavItem, string> = Object.fromEntries(
  allItems.map(item => [item.id, item.path]),
) as Record<NavItem, string>;

const pathToNav = new Map<string, NavItem>(
  allItems.map(item => [item.path, item.id]),
);

const navToEntry = new Map<NavItem, NavEntry>(
  allItems.map(item => [item.id, item]),
);

// ── Hook ─────────────────────────────────────────────────────────

export function useNavigation() {
  const location = useLocation();

  const activeNav = useMemo<NavItem>(() => {
    return pathToNav.get(location.pathname) || 'chat';
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
