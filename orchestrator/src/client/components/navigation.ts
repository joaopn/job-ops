import { FileText, LayoutDashboard, Settings } from "lucide-react";

export type NavLink = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  activePaths?: string[];
};

export const NAV_LINKS: NavLink[] = [
  {
    to: "/jobs/ready",
    label: "Jobs",
    icon: LayoutDashboard,
    activePaths: [
      "/jobs/ready",
      "/jobs/discovered",
      "/jobs/applied",
      "/jobs/all",
    ],
  },
  { to: "/cv", label: "My CV", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const isNavActive = (
  pathname: string,
  to: string,
  activePaths?: string[],
) => {
  if (pathname === to) return true;
  if (!activePaths) return false;
  return activePaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
};
