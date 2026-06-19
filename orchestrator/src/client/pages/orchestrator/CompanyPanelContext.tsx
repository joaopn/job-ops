/**
 * Lets any job surface under the Manage screen open the company-jobs panel by
 * employer name without prop-drilling. The dialog state + data fetch live in
 * OrchestratorPage; this just exposes the opener.
 */

import { createContext, useContext } from "react";

export interface CompanyPanelController {
  openCompanyJobs: (employer: string) => void;
}

// No-op fallback so company-name buttons rendered outside a provider (e.g. in
// isolation tests) degrade to plain inert text instead of crashing — this is a
// non-critical enhancement, not a hard dependency of the job row.
const NOOP_CONTROLLER: CompanyPanelController = {
  openCompanyJobs: () => {},
};

const CompanyPanelContext =
  createContext<CompanyPanelController>(NOOP_CONTROLLER);

export const CompanyPanelProvider = CompanyPanelContext.Provider;

export function useCompanyPanel(): CompanyPanelController {
  return useContext(CompanyPanelContext);
}
