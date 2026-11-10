import type { Project } from "./types";

/** Removals a project is forecast to deliver over its whole crediting period. */
export function lifetimeForecast(project: Project): number {
  return project.annualForecast * Math.max(1, project.creditingYears);
}

/** Share of the lifetime forecast already issued, 0–100. */
export function issuedShare(project: Project): number {
  const forecast = lifetimeForecast(project);
  return forecast > 0 ? Math.min(100, (project.creditsIssued / forecast) * 100) : 0;
}

export type PortfolioMetrics = {
  projects: number;
  /** tCO₂e over every crediting period. */
  forecast: number;
  /** tCO₂e per year. */
  annualForecast: number;
  issued: number;
  retired: number;
};

export function portfolioMetrics(projects: Project[]): PortfolioMetrics {
  return projects.reduce<PortfolioMetrics>(
    (sum, project) => ({
      projects: sum.projects + 1,
      forecast: sum.forecast + lifetimeForecast(project),
      annualForecast: sum.annualForecast + project.annualForecast,
      issued: sum.issued + project.creditsIssued,
      retired: sum.retired + project.creditsRetired,
    }),
    { projects: 0, forecast: 0, annualForecast: 0, issued: 0, retired: 0 },
  );
}
