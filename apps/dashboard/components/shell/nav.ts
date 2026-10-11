import { BookMarked, GitPullRequest, House, Settings, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const MAIN_NAV: NavItem[] = [
  { href: "/overview", label: "Overview", icon: House },
  { href: "/pull-requests", label: "Pull requests", icon: GitPullRequest },
  { href: "/repositories", label: "Repositories", icon: BookMarked },
];

export const WORKSPACE_NAV: NavItem[] = [{ href: "/settings", label: "Settings", icon: Settings }];

export const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
