"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Building2, Search, X } from "lucide-react";
import { AccountToolbar } from "../nav/account-toolbar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCatalog } from "@/store/catalog-store";
import { useDashboard } from "@/store/dashboard-store";

/** Every control in the bar is the same glass pill. */
const PILL = "glass flex h-11 items-center rounded-full";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olivine-500";

/* ── Identity box (left) ────────────────────────────────────────── */

/** Who is signed in, for which tenant. */
function TenantMark() {
  const tenantId = useDashboard((state) => state.tenantId);
  const tenants = useCatalog((state) => state.tenants);
  // The catalogue is read from the Atlas table; until it arrives, show the id.
  const tenant = tenants.find((entry) => entry.id === tenantId) ?? { id: tenantId, name: tenantId, short: tenantId.slice(0, 4).toUpperCase() };
  const user = useCurrentUser();

  const initials = (user?.name ?? user?.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <div className={`${PILL} gap-2.5 pr-4 pl-1`}>
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full text-[10px] font-bold tracking-tight text-calcite shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
        style={{ background: "linear-gradient(in oklab 140deg, #0d1802 0%, #414f1b 58%, #8b9c44 125%)" }}
        aria-hidden
      >
        {tenant.short}
      </span>
      <div className="leading-tight">
        <div className="flex items-center gap-1.5">
          <Building2 className="size-3 text-strata-700" />
          <span className="text-[13px] font-semibold tracking-tight text-earth">{tenant.name}</span>
          <code className="rounded-full bg-strata-300/45 px-1.5 py-px text-[9.5px] font-semibold text-strata-700" title="Tenant id">
            {tenant.id}
          </code>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-strata-700">
          <span className="grid size-4 place-items-center rounded-full bg-olivine-100 text-[8px] font-bold text-olivine-800">
            {initials}
          </span>
          <span className="max-w-52 truncate font-medium text-earth" title={user?.email}>
            {user ? (user.name ?? user.email) : "Signing in…"}
          </span>
          {user?.role ? <span className="text-[10px]">· {user.role}</span> : null}
        </div>
      </div>
    </div>
  );
}

/* ── Search (centre, map state) ─────────────────────────────────── */

const noSubscribe = () => () => {};
const shortcutLabel = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");

function AtlasSearch() {
  const query = useDashboard((state) => state.query);
  const setQuery = useDashboard((state) => state.setQuery);
  const input = useRef<HTMLInputElement>(null);
  const shortcut = useSyncExternalStore(noSubscribe, shortcutLabel, () => "⌘K");

  // ⌘K / Ctrl K jumps to the search from anywhere on the map.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <label className={`${PILL} glass-field pointer-events-auto w-full max-w-[540px] gap-2.5 pr-1.5 pl-4`}>
      <Search className="size-4 shrink-0 text-strata-700" />
      <input
        ref={input}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Escape clears the search first; the map handles it once the field is empty.
          if (event.key === "Escape" && query) {
            event.stopPropagation();
            setQuery("");
          }
        }}
        aria-label="Search projects"
        placeholder="Search project, country or methodology"
        className="h-full w-full bg-transparent text-[13.5px] text-earth placeholder:text-strata-600 focus:outline-none"
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            input.current?.focus();
          }}
          aria-label="Clear search"
          className={`grid size-8 shrink-0 place-items-center rounded-full text-strata-700 transition-colors hover:bg-white/80 hover:text-earth ${FOCUS}`}
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="glass-well hidden h-7 shrink-0 items-center rounded-full px-2.5 font-sans text-[10.5px] font-semibold text-strata-700 sm:flex">
          {shortcut}
        </kbd>
      )}
    </label>
  );
}

/* ── Top Bar ────────────────────────────────────────────────────── */

/**
 * The Atlas bar: who is signed in, the project search and the account
 * tools. An open project shows its live chain over the whole screen, with
 * its own bar.
 */
export function TopBar() {
  return (
    <header className="pointer-events-auto relative flex h-16 items-center px-5">
      <div className="relative z-10 flex h-11 items-center gap-2">
        <TenantMark />
      </div>
      <div className="pointer-events-none absolute inset-x-5 inset-y-0 z-0 flex items-center justify-center">
        <AtlasSearch />
      </div>
      <AccountToolbar className="relative z-10 ml-auto" />
    </header>
  );
}
