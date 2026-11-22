import Link from "next/link";
import { BookOpen, LogOut } from "lucide-react";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olivine-500";

/** Top-right toolbar on every light page: the guide and signing out, in one glass pill. */
export function AccountToolbar({ className = "" }: { className?: string }) {
  return (
    <div className={`glass flex h-11 items-center gap-0.5 rounded-full p-1 ${className}`}>
      <Link
        href="/manual"
        className={`flex h-9 items-center gap-2 rounded-full px-3.5 text-[12px] font-semibold text-strata-700 transition-colors hover:bg-white/80 hover:text-earth ${FOCUS}`}
      >
        <BookOpen className="size-3.5 text-olivine-700" />
        Guide
      </Link>
      <span className="h-5 w-px bg-strata-400/40" aria-hidden />
      <a
        href="/auth/logout"
        title="Sign out"
        aria-label="Sign out"
        className={`grid size-9 place-items-center rounded-full text-strata-700 transition-colors hover:bg-white/80 hover:text-earth ${FOCUS}`}
      >
        <LogOut className="size-3.5" />
      </a>
    </div>
  );
}
