import type { NavLink } from '~/common';
import { useActivePanel, resolveActivePanel } from '~/Providers';
import BrandLogo from '~/components/ui/BrandLogo';

export default function Nav({ links }: { links: NavLink[] }) {
  const { active } = useActivePanel();
  const effectiveActive = resolveActivePanel(active, links);
  return (
    <div className="text-text-primary flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center px-4">
        <BrandLogo className="h-8 w-32" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        {links.map((link) =>
          link.id === effectiveActive && link.Component ? <link.Component key={link.id} /> : null,
        )}
      </div>
    </div>
  );
}
