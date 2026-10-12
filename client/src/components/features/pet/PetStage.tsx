import React, { useCallback, useEffect, useRef, useState } from "react";
import { clipUrl, type ClipId } from "./clips";
import { clipFor, shouldLoop, type PetReaction, type PetState } from "./scheduler";
import "./PetStage.css";

/**
 * The pet: a transparent video that reacts to what the assistant is doing.
 *
 * Two `<video>` elements take turns rather than one being re-pointed, because
 * swapping `src` on a single element blinks: the browser has nothing to show
 * between the old frame being torn down and the new one decoding. The incoming
 * clip loads *behind* the outgoing one and only becomes visible once it has
 * data, so the cross-fade has no gap to fall into.
 *
 * Patterns taken from the reference implementation, each of which fixes a bug
 * that is invisible until it bites:
 *
 *  - the outgoing element has its `onended` cleared and is paused. Otherwise it
 *    finishes later and fires the handler, yanking the pet back mid-clip.
 *  - loads are guarded by a generation counter, so a burst of state changes
 *    cannot let an older fetch win the race and show the wrong clip.
 *  - each clip is fetched to a blob URL before being assigned. Pointing `src`
 *    straight at the file makes the element stream it, and on a slow connection
 *    that can stall indefinitely — the pet simply freezes. A blob is one
 *    request with a fixed end.
 */
interface PetStageProps {
  state: PetState;
  reaction?: PetReaction;
  /** Rendered height in px. The art is 16:9 with the character centred. */
  size?: number;
}

const PetStage: React.FC<PetStageProps> = ({ state, reaction = null, size = 132 }) => {
  const [mounted, setMounted] = useState(false);
  const aRef = useRef<HTMLVideoElement | null>(null);
  const bRef = useRef<HTMLVideoElement | null>(null);
  /** Which element is currently on top: 0 = a, 1 = b. */
  const frontRef = useRef(0);
  /** Bumped on every switch; a load that finishes late is discarded. */
  const genRef = useRef(0);
  const urlsRef = useRef<(string | null)[]>([null, null]);
  const mountedRef = useRef(false);

  const clip = clipFor(state, reaction);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const url of urlsRef.current) if (url) URL.revokeObjectURL(url);
      urlsRef.current = [null, null];
    };
  }, []);

  const switchTo = useCallback((next: ClipId) => {
    const front = frontRef.current;
    const incoming = front === 0 ? bRef.current : aRef.current;
    const outgoing = front === 0 ? aRef.current : bRef.current;
    if (!incoming) return;
    const slot = front === 0 ? 1 : 0;
    const gen = ++genRef.current;

    // Loop clips are endless, so `ended` never fires for them; one-shots need
    // the fallback, which the parent supplies via `onEnded`.
    incoming.loop = shouldLoop(next);
    incoming.muted = true;
    incoming.playsInline = true;
    incoming.onended = null;

    void fetch(clipUrl(next))
      .then((res) => {
        if (!res.ok) throw new Error(`clip ${next}: HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!mountedRef.current || genRef.current !== gen) return;
        const previous = urlsRef.current[slot];
        if (previous) URL.revokeObjectURL(previous);
        const url = URL.createObjectURL(blob);
        urlsRef.current[slot] = url;
        incoming.src = url;
        incoming.load();
      })
      .catch(() => {
        // A missing clip must not break the launcher: leave the current frame.
      });

    const onReady = () => {
      incoming.removeEventListener("loadeddata", onReady);
      if (!mountedRef.current || genRef.current !== gen) return;
      outgoing?.classList.remove("is-front");
      if (outgoing) {
        outgoing.onended = null;
        outgoing.pause();
      }
      incoming.classList.add("is-front");
      frontRef.current = slot;
      setMounted(true);
      void incoming.play().catch(() => {
        // Autoplay can be refused before a user gesture; the poster frame stays.
      });
    };
    incoming.addEventListener("loadeddata", onReady);
  }, []);

  useEffect(() => {
    switchTo(clip);
  }, [clip, switchTo]);

  return (
    <span className="pet-frame" aria-hidden="true">
      <span className="pet-stage" style={{ height: size }}>
        <video ref={aRef} className="pet-clip is-front" muted playsInline preload="auto" />
        <video ref={bRef} className="pet-clip" muted playsInline preload="auto" />
      </span>
      {!mounted && <span className="pet-stage-empty" />}
    </span>
  );
};

export default PetStage;
