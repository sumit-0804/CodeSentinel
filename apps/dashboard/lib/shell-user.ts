import type { CurrentUser } from "@/lib/auth";
import { initials } from "@/lib/auth";
import { robotAvatarDataUri } from "@/lib/robot-avatar";
import type { ShellUser } from "@/components/shell/account-menus";

const PROVIDER_LABEL: Record<string, string> = { github: "GitHub", google: "Google", email: "email" };

/** The narrow user shape the client components need; nothing else from the claims reaches the browser. */
export function toShellUser(user: CurrentUser): ShellUser {
  return {
    displayName: user.name ?? user.email ?? "Your account",
    email: user.email,
    // Drawn on the server; DiceBear's SVG doesn't contain the seed, so the user id stays private.
    avatarUrl: user.avatarUrl ?? robotAvatarDataUri(user.id),
    initials: initials(user),
    signedInWith: PROVIDER_LABEL[user.provider] ?? user.provider,
  };
}
