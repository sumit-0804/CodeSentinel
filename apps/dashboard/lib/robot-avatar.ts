import { createAvatar } from "@dicebear/core";
import * as botttsNeutral from "@dicebear/bottts-neutral";

// Neon palette (cyan, violet, mint, rose, amber) so every robot sits on a brand colour.
const BACKGROUNDS = ["3df0ff", "9b6cff", "39f5a6", "ff4d73", "ffb84d"];

/** A DiceBear "Bottts Neutral" robot as an SVG data URI; the same seed always draws the same robot. */
export function robotAvatarDataUri(seed: string): string {
  return createAvatar(botttsNeutral, { seed, size: 64, backgroundColor: BACKGROUNDS }).toDataUri();
}
