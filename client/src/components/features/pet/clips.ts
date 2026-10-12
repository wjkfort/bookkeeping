/**
 * The desktop pet's animation set.
 *
 * Five clips today, all generated from the prompts in
 * `docs/features/PET_VIDEO_PROMPTS.md` and processed by the pipeline in
 * `pet-assets/` (see its README for how a clip becomes a `public/pet/*.webm`).
 *
 * Names here are the file names under `public/pet/` and the keys the scheduler
 * uses; `label` is only for the settings UI. Keeping the file names ASCII means
 * the URLs stay readable instead of percent-encoded.
 */

/** Every clip the app ships. Ids must match a file in `public/pet/`. */
export const CLIPS = ["idle", "thinking", "writing", "done", "failed"] as const;

export type ClipId = (typeof CLIPS)[number];

export interface ClipMeta {
  /** Human label, for a settings list. */
  label: string;
  /** Corresponds to which state the assistant is in. */
  meaning: string;
  /**
   * `loop` clips play until the state changes (a long job stays animated);
   * `once` clips play through and then the scheduler falls back to `idle`.
   */
  playback: "loop" | "once";
}

export const CLIP_META: Record<ClipId, ClipMeta> = {
  idle: { label: "待机呼吸", meaning: "空闲", playback: "loop" },
  thinking: { label: "思考翻书", meaning: "AI 正在想", playback: "loop" },
  writing: { label: "低头记一笔", meaning: "正在记账", playback: "loop" },
  done: { label: "数钱满意", meaning: "记账成功", playback: "once" },
  failed: { label: "出错冒汗", meaning: "记账失败", playback: "once" },
};

/** Where a clip's file lives, and the extension the build expects. */
export const clipUrl = (id: ClipId): string => `/pet/${id}.webm`;
