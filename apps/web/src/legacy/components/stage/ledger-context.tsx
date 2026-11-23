"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Ledger } from "@/hooks/use-ledger";
import type { Project, SubmissionBatch } from "@/lib/types";

interface StageContextValue {
  project: Project;
  batches: SubmissionBatch[] | null;
  ledger: Ledger;
}

const StageContext = createContext<StageContextValue | null>(null);

/** One ledger per open project, shared by the panels and the calculation view. */
export function StageProvider({ value, children }: { value: StageContextValue; children: ReactNode }) {
  return <StageContext.Provider value={value}>{children}</StageContext.Provider>;
}

export function useStageContext(): StageContextValue {
  const value = useContext(StageContext);
  if (!value) throw new Error("useStageContext must be used inside <StageProvider>");
  return value;
}
