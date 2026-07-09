/**
 * User Profiles — multiple self-contained job databases, switchable in-app.
 *
 * A "user profile" is a whole database. The active profile is always the live
 * `jobs.db`; inactive profiles are closed SQLite files in the user-profiles
 * store. Numeric stats are `null` when the stat could not be read (older-shape
 * DBs may lack a table); `searchProfileNames` collapses to `[]` in that case.
 */

export interface UserProfileStats {
  jobsTotal: number | null;
  liveJobs: number | null;
  cvDocuments: number | null;
  searchProfileNames: string[];
  lastUpdatedAt: string | null;
}

export interface StoredUserProfile {
  id: string;
  name: string;
  sizeBytes: number;
  stats: UserProfileStats | null;
  invalid?: boolean;
  invalidReason?: string;
}

export interface ActiveUserProfile {
  name: string;
  sizeBytes: number;
  stats: UserProfileStats | null;
}

export interface UserProfilesListResponse {
  active: ActiveUserProfile;
  stored: StoredUserProfile[];
}
