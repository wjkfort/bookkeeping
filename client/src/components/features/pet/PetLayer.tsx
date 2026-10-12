import React, { useCallback, useEffect, useRef, useState } from "react";
import PetStage from "./PetStage";
import { CLIP_META, type ClipId } from "./clips";
import { clipFor, shouldLoop, type PetReaction, type PetState } from "./scheduler";

/**
 * The pet as a floating layer that *is* the assistant launcher.
 *
 * This is a real `<button>`, not a decorative overlay: dragging must never be
 * the only way to reach the assistant, so it keeps a focus ring, `aria-expanded`
 * and arrow-key nudge. It happens to look like a character instead of a bubble.
 *
 * Position is the button's top-left, persisted so she stays where she was put.
 * The layer is transparent and sized to the character, so the empty space
 * around her must not swallow clicks — the art's box is the hit area, which is
 * the same trade-off the button had before.
 */

const POSITION_KEY = "bk_pet_position";
const DRAG_THRESHOLD = 4;
const KEYBOARD_STEP = 16;
const EDGE = 8;
/** Display height. The clips are 16:9; she is centred with empty sides. */
const PET_H = 168;
/**
 * The art's full width and the slice of it she occupies.
 *
 * The video is wider than her clickable box and is meant to overflow it, so the
 * frame can reach past the viewport even when she does not. These are used to
 * keep the default corner position clear of the edge; `CHAR_WIDTH_RATIO` is
 * measured from the clips (she fills the middle 35.6% of the 16:9 frame).
 */
const FRAME_W = (PET_H * 16) / 9;
const CHAR_WIDTH_RATIO = 0.356;
/** Distance from the right edge, chosen so the default position shows the whole
 *  frame rather than letting its empty side run off screen. */
const DEFAULT_RIGHT = Math.max(24, Math.round((FRAME_W * (1 - CHAR_WIDTH_RATIO)) / 2) + 8);
/** ...and the equivalent for the bottom, derived from the same layout. */
const DEFAULT_BOTTOM = DEFAULT_RIGHT;
/** How long a one-shot outcome stays before she returns to the steady state. */
const REACTION_MS = 2600;

interface Position {
  x: number;
  y: number;
}

/**
 * A random spot for a first visit.
 *
 * She should turn up somewhere different each time rather than always in the
 * same corner, but a uniformly random point would occasionally put her half off
 * screen or under the dock. These are the four corners of the safe area, inset
 * from the viewport and from the top bar, with a little jitter so the choice is
 * not obviously one of four.
 */
const randomStartPosition = (w: number, h: number): Position => {
  const M = 28;
  const TOP = 84;
  const left = M;
  const top = TOP;
  const right = Math.max(left, window.innerWidth - w - M);
  const bottom = Math.max(top, window.innerHeight - h - M);
  const spots: Position[] = [
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: right, y: top },
    { x: left, y: top },
  ];
  const pick = spots[Math.floor(Math.random() * spots.length)];
  const jitter = (span: number) => Math.round((Math.random() - 0.5) * span);
  return clampToViewport({ x: pick.x + jitter(90), y: pick.y + jitter(70) }, w, h);
};

const readPosition = (): Position | null => {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Position;
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
};

/** The layer is 16:9; this is the box she can be dragged within. */
const layerSize = (height: number) => ({ w: Math.round((height * 16) / 9), h: height });

const clampToViewport = (pos: Position, w: number, h: number): Position => ({
  x: Math.min(Math.max(EDGE, pos.x), Math.max(EDGE, window.innerWidth - w - EDGE)),
  y: Math.min(Math.max(EDGE, pos.y), Math.max(EDGE, window.innerHeight - h - EDGE)),
});

/** Her clickable box in viewport coordinates. */
export interface PetBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PetLayerProps {
  isOpen: boolean;
  /** The assistant is mid-turn. */
  thinking?: boolean;
  /**
   * The assistant asked to run a tool and the server is executing it.
   *
   * This is the phase where a write actually lands, so it is the one that reads
   * as "she is entering it" rather than "she is reading". Without it the whole
   * turn would show the same clip, and the write animation would never play.
   */
  toolRunning?: boolean;
  /** A write landed (`done`) or was refused (`failed`). */
  reaction?: PetReaction;
  /** No server key: she idles, and the dock explains why. */
  asleep?: boolean;
  label: string;
  onToggle: () => void;
  /** Fired when a one-shot clip finishes, so the caller can clear the reaction. */
  onClipEnded?: (clip: ClipId) => void;
  /** Something is overdue: show the reminder dot above her head. */
  hasReminders?: boolean;
  /**
   * Her box, in viewport coordinates, whenever it changes.
   *
   * The dock anchors itself to this so the conversation stays attached to her —
   * dragging her takes the dock along, which is what makes it read as talking
   * to the character rather than to a panel that happens to be nearby.
   */
  onBounds?: (box: PetBounds) => void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}

const PetLayer: React.FC<PetLayerProps> = ({
  isOpen,
  thinking = false,
  toolRunning = false,
  reaction = null,
  asleep = false,
  label,
  onToggle,
  onClipEnded,
  hasReminders = false,
  onBounds,
  buttonRef,
}) => {
  const { w: boxW, h: boxH } = layerSize(PET_H);
  const [position, setPosition] = useState<Position | null>(() => {
    const saved = readPosition();
    if (saved) return saved;
    try {
      return randomStartPosition(boxW, boxH);
    } catch {
      return null;
    }
  });
  const [dragging, setDragging] = useState(false);
  const localRef = useRef<HTMLButtonElement | null>(null);
  const posRef = useRef<Position | null>(position);
  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const attachRef = useCallback(
    (node: HTMLButtonElement | null) => {
      localRef.current = node;
      if (buttonRef) buttonRef.current = node;
    },
    [buttonRef],
  );

  const persist = useCallback((next: Position) => {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    } catch {
      // Private mode: the position simply does not survive the session.
    }
  }, []);

  const apply = useCallback((next: Position) => {
    posRef.current = next;
    setPosition(next);
  }, []);

  // Tell the dock where she is. Runs on mount (so an opened dock has a position
  // before its first paint) and on every move.
  useEffect(() => {
    if (!onBounds) return;
    const node = localRef.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    onBounds({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, [position, onBounds]);

  // Persist the random starting spot, so a reload puts her back where she was.
  useEffect(() => {
    if (position) persist(position);
    // Only on mount: later moves persist themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep her on screen when the window shrinks.
  useEffect(() => {
    if (!position) return;
    const onResize = () => {
      const current = posRef.current;
      if (!current) return;
      const next = clampToViewport(current, boxW, boxH);
      if (next.x !== current.x || next.y !== current.y) apply(next);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [position, boxW, boxH, apply]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const node = localRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    drag.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    try {
      node.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; move/up still work.
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state) return;
    const travelled = Math.abs(e.clientX - state.startX) + Math.abs(e.clientY - state.startY);
    if (!state.moved && travelled < DRAG_THRESHOLD) return;
    state.moved = true;
    if (!dragging) setDragging(true);
    apply(clampToViewport({ x: e.clientX - state.dx, y: e.clientY - state.dy }, boxW, boxH));
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    drag.current = null;
    const node = localRef.current;
    if (node?.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
    if (state?.moved) {
      // A drag must not also count as a click on the assistant.
      suppressClick.current = true;
      if (posRef.current) persist(posRef.current);
    }
    setDragging(false);
  };

  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onToggle();
  };

  /** A draggable control needs a non-pointer path to the same outcome. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const deltas: Record<string, Position> = {
      ArrowLeft: { x: -KEYBOARD_STEP, y: 0 },
      ArrowRight: { x: KEYBOARD_STEP, y: 0 },
      ArrowUp: { x: 0, y: -KEYBOARD_STEP },
      ArrowDown: { x: 0, y: KEYBOARD_STEP },
    };
    const delta = deltas[e.key];
    if (!delta) return;
    e.preventDefault();
    const rect = localRef.current?.getBoundingClientRect();
    const base =
      posRef.current ??
      ({
        x: rect ? rect.left : window.innerWidth - boxW - EDGE,
        y: rect ? rect.top : window.innerHeight - boxH - EDGE,
      } satisfies Position);
    const next = clampToViewport({ x: base.x + delta.x, y: base.y + delta.y }, boxW, boxH);
    apply(next);
    persist(next);
  };

  // What she is beats how she looks: a missing key is a steady state, so it
  // outranks a transient outcome.
  const petState: PetState = asleep
    ? "idle"
    : toolRunning
      ? "writing"
      : thinking
        ? "thinking"
        : "idle";
  const clip = clipFor(petState, asleep ? null : reaction);

  // One-shot outcomes hand back to the steady state after a beat: the clips are
  // ten seconds long and an outcome should not linger that long on screen.
  //
  // `onClipEnded` must be referentially stable (the caller memoises it) or this
  // effect re-runs on every render and restarts the countdown.
  useEffect(() => {
    if (!reaction) return;
    const id = window.setTimeout(() => onClipEnded?.(reaction), REACTION_MS);
    return () => window.clearTimeout(id);
  }, [reaction, onClipEnded]);

  const style: React.CSSProperties = {
    // The height lives in CSS so the stylesheet can derive the box width from
    // it; passing a custom property needs the cast.
    ...({ "--pet-h": `${PET_H}px` } as React.CSSProperties),
    ...(position
      ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
      : { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM }),
  };

  return (
    <button
      type="button"
      ref={attachRef}
      className={`pet-layer${isOpen ? " is-open" : ""}${dragging ? " is-dragging" : ""}`}
      style={style}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      aria-label={label}
      aria-expanded={isOpen}
      title={`${label} · ${CLIP_META[clip].label}${shouldLoop(clip) ? "" : "（播完回待机）"}`}
    >
      <PetStage state={petState} reaction={reaction} size={PET_H} />
      {hasReminders && <span className="pet-layer-badge" aria-hidden="true" />}
    </button>
  );
};

export default PetLayer;
