import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { useNavigation } from '../hooks/useNavigation';
import type { NavEntry, NavItem } from '../hooks/useNavigation';

interface SidebarProps {
  active: NavItem;
  onNavigate: (item: NavItem) => void;
  isOpen: boolean;
}

export function Sidebar({ active, onNavigate, isOpen }: SidebarProps) {
  const { navSections, footerItems } = useNavigation();
  const assetBase = import.meta.env.BASE_URL || '/';
  const wordmarkSrc = `${assetBase}hermes-wordmark.svg`;
  const heroSrc = `${assetBase}Hermes_anime.jpg`;

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => onNavigate(active)} // trigger close via parent
        />
      )}
      <motion.aside
        initial={false}
        animate={{
          width: isOpen ? 280 : 0,
          opacity: isOpen ? 1 : 0,
        }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        className={cn(
          'h-full flex-shrink-0 border-r border-border bg-secondary/50 overflow-hidden',
          'lg:relative lg:z-20',
          isOpen ? 'fixed left-0 top-0 z-40 lg:static' : 'relative z-20',
        )}
      >
      <div className="flex flex-col h-full p-4 w-[280px]">
        {/* Logo Section */}
        <div className="mb-6 px-2">
          <img
            src={wordmarkSrc}
            alt="ἙΡΜΗΣ"
            className="h-12 w-auto max-w-[190px] drop-shadow-[0_4px_18px_rgba(255,180,0,0.18)]"
          />
          <p className="mt-1 pl-1 text-[11px] text-muted-foreground font-medium tracking-[0.18em] uppercase">
            Local Cockpit
          </p>
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card/70 shadow-sm">
            <img
              src={heroSrc}
              alt="Hermes anime"
              className="h-24 w-full object-cover object-top"
            />
          </div>
        </div>

        {/* Profile Switcher — removed, kept in Header */}

        {/* Sectioned Navigation */}
        <nav className="flex-1 space-y-4 overflow-y-auto pr-1">
          {navSections.map(section => (
            <div key={section.label}>
              <div className="px-3 pb-1.5 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-[0.14em]">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map(item => (
                  <NavButton key={item.id} item={item} active={active === item.id} onClick={() => onNavigate(item.id)} />
                ))}
              </div>
            </div>
          ))}
          <div className="pt-2 mt-2 border-t border-border">
            <div className="space-y-0.5">
              {footerItems.map(item => (
                <NavButton key={item.id} item={item} active={active === item.id} onClick={() => onNavigate(item.id)} />
              ))}
            </div>
          </div>
        </nav>

      </div>
    </motion.aside>
    </>
  );
}

function NavButton({ item, active, onClick }: { item: Pick<NavEntry, 'icon' | 'label'>; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors group relative',
        active
          ? 'bg-muted text-foreground font-medium border-l-2 border-primary -ml-[1px]'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground font-medium border-l-2 border-transparent -ml-[1px]'
      )}
    >
      <Icon size={16} className={active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'} />
      <span className="text-sm">{item.label}</span>
    </button>
  );
}
