import { cn } from '~/utils';

export default function BrandLogo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span className={cn('bp-logo', className)}>
        <img src="/brand/logo-symbol-v1.svg" alt="BP Batam" />
      </span>
    );
  }
  return (
    <span className={cn('bp-logo', className)}>
      <img className="bp-logo-light" src="/brand/logo-light-v2.svg" alt="BP Batam" />
      <img className="bp-logo-dark" src="/brand/logo-dark-v2.svg" alt="BP Batam" />
    </span>
  );
}
