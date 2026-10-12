/**
 * Which clip plays when.
 *
 * Kept as pure functions, separate from React and the DOM, for the same reason
 * the reference implementation does it: the scheduling is the part that is easy
 * to get wrong, and this way it can be tested without a browser.
 *
 * Two layers, in priority order:
 *
 *  1. **Reactions** — a write landed or failed. They are one-shot: the clip
 *     plays through and the pet falls back to whatever the steady state is.
 *  2. **Steady state** — idle, thinking, or working. These loop until the state
 *     actually changes.
 *
 * There is no random idle pool yet: with a single idle clip, dice would have
 * nothing to choose between. `rollOnceThenIdle` exists so the moment a second
 * idle clip is added, the "play one, then settle" behaviour is already right.
 */
import { CLIP_META, type ClipId } from "./clips";

/** What the assistant is doing. */
export type PetState = "idle" | "thinking" | "writing";

/** A transient outcome layered on top of the steady state. */
export type PetReaction = "done" | "failed" | null;

/**
 * The clip for the current moment.
 *
 * A reaction outranks the steady state, because it is news: while the assistant
 * is still thinking, a failure from a previous write should not be swallowed.
 */
export const clipFor = (state: PetState, reaction: PetReaction): ClipId =>
  reaction ?? state;

/** True when this clip should be left playing until something changes. */
export const shouldLoop = (clip: ClipId): boolean => CLIP_META[clip].playback === "loop";

/**
 * Pick an idle clip at random, never repeating `current`.
 *
 * One entry today; the guard exists so adding a second idle animation does not
 * produce the "she stops, then does the same thing again" stutter.
 */
export const rollOnceThenIdle = (pool: readonly ClipId[], current: ClipId): ClipId => {
  const options = pool.filter((id) => id !== current);
  const source = options.length ? options : pool;
  if (!source.length) return "idle";
  return source[Math.floor(Math.random() * source.length)];
};
