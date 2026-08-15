import type { NavLink } from '~/common';
import { useActivePanel, resolveActivePanel } from '~/Providers';

export default function Nav({ links }: { links: NavLink[] }) {
  const { active } = useActivePanel();
  const effectiveActive = resolveActivePanel(active, links);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden text-text-primary">
      <div className="border-b border-border-light px-4 py-3">
        <div className="flex items-center gap-3">
          <img
            src="/assets/bp-batam.png"
            alt="BP Batam"
            className="h-10 w-auto max-w-[150px] object-contain object-left"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-primary">BP Batam AI</div>
            <div className="truncate text-xs text-text-secondary">Layanan AI Terpadu</div>
          </div>
        </div>
      </div>
      {links.map((link) =>
        link.id === effectiveActive && link.Component ? <link.Component key={link.id} /> : null,
      )}
    </div>
  );
}
