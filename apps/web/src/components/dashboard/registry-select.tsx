"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useDashboard } from "@/store/dashboard-store";
import type { Registry } from "@/lib/types";

const REGISTRY_OPTIONS: Registry[] = ["Isometric", "Puro.earth"];

export function RegistrySelect() {
  const [open, setOpen] = useState(false);
  const registryFilter = useDashboard((state) => state.registryFilter);
  const setRegistryFilter = useDashboard((state) => state.setRegistryFilter);
  const selected = REGISTRY_OPTIONS.includes(registryFilter as Registry)
    ? (registryFilter as Registry)
    : REGISTRY_OPTIONS[0];

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="glass flex h-12 items-center gap-2 rounded-2xl px-3.5 text-xs font-medium text-frost"
      >
        <span>{selected}</span>
        <ChevronDown
          className={`size-3.5 text-mist transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close registry menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <ul
            role="listbox"
            className="glass absolute top-full left-0 z-20 mt-2 min-w-full overflow-hidden rounded-2xl p-1.5 shadow-2xl"
          >
            {REGISTRY_OPTIONS.map((option) => {
              const active = option === selected;
              return (
                <li key={option} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      setRegistryFilter(option);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors ${
                      active
                        ? "bg-carbon-400/15 text-carbon-400"
                        : "text-frost hover:bg-ink-800"
                    }`}
                  >
                    <span className="flex-1 whitespace-nowrap">{option}</span>
                    {active ? <Check className="size-3.5 shrink-0" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
