import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link, useInRouterContext } from "react-router-dom";

interface ContextualEntityLinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

/** A visible, keyboard-accessible link to an entity whose ID came from the API. */
export default function ContextualEntityLink({
  to,
  children,
  className = "",
  ariaLabel,
}: ContextualEntityLinkProps) {
  const inRouter = useInRouterContext();
  const labelClass = `inline-flex items-center gap-1 font-semibold text-brand underline-offset-4 hover:underline ${className}`;
  const inner = (
    <>
      <span>{children}</span>
      <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
    </>
  );
  if (inRouter) {
    return (
      <Link to={to} className={labelClass} aria-label={ariaLabel}>
        {inner}
      </Link>
    );
  }
  return (
    <a href={to} className={labelClass} aria-label={ariaLabel}>
      {inner}
    </a>
  );
}
