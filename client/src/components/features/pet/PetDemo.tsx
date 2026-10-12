import React, { useState } from "react";
import PetStage from "./PetStage";
import { CLIP_META } from "./clips";
import { clipFor, type PetReaction, type PetState } from "./scheduler";

/**
 * Development-only preview for the pet (`?petdemo=1`).
 *
 * It exists because the pet's five clips are driven by the assistant's real
 * state, and there is no cheap way to make the app think, fail a write, and
 * succeed on demand. Here the state is a button.
 *
 * Vite treeshakes this in a production build — `main.tsx` only reaches it
 * behind `import.meta.env.DEV`.
 */
const STATES: PetState[] = ["idle", "thinking", "writing"];
const REACTIONS: PetReaction[] = [null, "done", "failed"];

const PetDemo: React.FC = () => {
  const [state, setState] = useState<PetState>("idle");
  const [reaction, setReaction] = useState<PetReaction>(null);
  const [size, setSize] = useState(220);

  return (
    <div className="pet-demo">
      <h1>桌宠预览</h1>
      <p className="pet-demo-note">
        当前片段：<code>{clipFor(state, reaction)}</code>
        （{CLIP_META[clipFor(state, reaction)].label}）
      </p>

      <div className="pet-demo-stage">
        <PetStage state={state} reaction={reaction} size={size} />
      </div>

      <div className="pet-demo-row">
        <span>状态</span>
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            className={s === state ? "is-on" : ""}
            onClick={() => {
              setState(s);
              setReaction(null);
            }}
          >
            {s} · {CLIP_META[s].meaning}
          </button>
        ))}
      </div>

      <div className="pet-demo-row">
        <span>瞬时结果</span>
        {REACTIONS.map((r) => (
          <button
            key={r ?? "none"}
            type="button"
            className={r === reaction ? "is-on" : ""}
            onClick={() => setReaction(r)}
          >
            {r === null ? "无" : `${r} · ${CLIP_META[r].label}`}
          </button>
        ))}
      </div>

      <div className="pet-demo-row">
        <span>大小</span>
        <input
          type="range"
          min={120}
          max={420}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        />
        <code>{size}px</code>
      </div>
    </div>
  );
};

export default PetDemo;
