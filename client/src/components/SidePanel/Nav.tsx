import type { NavLink } from '~/common';
import { useActivePanel, resolveActivePanel } from '~/Providers';

export default function Nav({ links }: { links: NavLink[] }) {
  const { active } = useActivePanel();
  const effectiveActive = resolveActivePanel(active, links);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden text-text-primary">
      <div className="flex min-h-[76px] items-center gap-3 border-b border-border-light px-4 py-3">
        <img
          src="/assets/hellodigi-mark.png"
          alt="HelloDigi"
          className="h-11 w-11 shrink-0 object-contain"
        />
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-text-primary">HelloDigi</div>
          <div className="truncate text-xs text-text-secondary">Agentic Platform</div>
        </div>
      </div>
      {links.map((link) =>
        link.id === effectiveActive && link.Component ? <link.Component key={link.id} /> : null,
      )}
    </div>
  );
}
