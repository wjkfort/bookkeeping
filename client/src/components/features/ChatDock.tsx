import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Flex, Text } from "@radix-ui/themes";
import { Cross2Icon, PaperPlaneIcon, PlusIcon, UpdateIcon } from "@radix-ui/react-icons";
import {
  getAiStatus,
  getAiMessages,
  currentSessionId,
  sendAiMessage,
  getAiGaps,
  markAiNoSpend,
} from "../../api";
import type { AiGaps, AiMessage } from "../../types";
import { useToast } from "../ui/toastContext";
import MiniMarkdown from "../ui/MiniMarkdown";
import PetLayer, { type PetBounds } from "./pet/PetLayer";
import type { PetReaction } from "./pet/scheduler";
import "./ChatDock.css";

/**
 * The conversational surface for the AI layer (R2, R3).
 *
 * Design constraints taken from the requirements, not invented here:
 *
 *  - **AI writes directly, with no confirmation step.** There is no approve
 *    button and no diff view: the reply says what was recorded and the report is
 *    the check. When a write lands, the dashboard is refreshed so the numbers
 *    move immediately.
 *  - **Reminders are computed server-side.** The gap list comes from
 *    `GET /ai/gaps`; the assistant only phrases it. Answering a day here writes
 *    `ledger_days`, so it stops being asked about.
 *  - **No key must not break the page.** `GET /ai/status` is checked first, and
 *    when the server reports `configured: false` the composer is replaced with a
 *    plain explanation rather than a box that always errors (R6).
 */
interface ChatDockProps {
  /** Called after the assistant recorded something, so figures refresh. */
  onChanged?: () => void;
  /**
   * Opens the manual entry form. The assistant is an accelerator, not the only
   * door into the ledger: with no server key the dock must still hand the user
   * a way to record something rather than an infrastructure message.
   */
  onManualEntry?: () => void;
}

/**
 * What the user should actually read.
 *
 * Two kinds of stored turn are machinery rather than conversation:
 *
 *  - `tool` turns are a tool's result — raw JSON, such as a list of unit codes.
 *  - an `assistant` turn carrying `tool_calls` is the model talking to itself
 *    before acting ("I'll record that. Let me check the units first."). It stays
 *    in the transcript because the provider needs it to replay the turn, but
 *    rendering it produces two bubbles per reply and exposes internal narration —
 *    including in whichever language the model happened to think in.
 *
 * A tool RESULT stores `{tool_call_id, name}` rather than an array, so testing
 * for an array is what separates "requested a tool" from "is a tool result".
 */
const visibleMessages = (messages: AiMessage[]): AiMessage[] =>
  messages.filter((m) => {
    if (m.role === "tool") return false;
    if ((m.content ?? "").trim().length === 0) return false;
    if (m.role === "assistant" && parseToolCalls(m.tool_calls) !== null) return false;
    return true;
  });

/** The stored `tool_calls` parsed as an array, or null when it is not one. */
function parseToolCalls(raw: string | null): unknown[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Turn the stored page into reading order.
 *
 * `GET /ai/messages` returns newest first, because that is the useful order for
 * cursor paging (`before=<id>` asks for older messages). A conversation window
 * is the opposite: oldest at the top, newest at the bottom, with the newest in
 * view — which is what every chat client does and what this component renders.
 *
 * Applied at every point the server list enters state, so the order is never a
 * property of which code path ran.
 */
const chronological = (fromApi: AiMessage[]): AiMessage[] => [...fromApi].reverse();

/**
 * Pull the server's own message out of a failed request.
 *
 * The API reports a refusal as `{ error, code }`, so surfacing `error` is what
 * tells the user *why* a write did not happen (an unknown unit, a category still
 * in use) instead of a generic failure.
 */
const serverMessage = (e: unknown): string | null => {
  if (typeof e === "object" && e !== null && "response" in e) {
    const data = (e as { response?: { data?: { error?: unknown } } }).response?.data;
    if (typeof data?.error === "string") return data.error;
  }
  return null;
};

/** Where the dock sits relative to her, and where its tail points. */
interface DockPlacement {
  left: number;
  bottom: number;
  /** Which edge of the dock faces her; the tail is drawn on it. */
  side: "left" | "right" | "top" | "bottom";
  /** Offset of the tail along that edge, in px, aimed at her centre. */
  tail: number;
}

const ChatDock: React.FC<ChatDockProps> = ({ onChanged, onManualEntry }) => {
  const { t } = useTranslation();
  const toast = useToast();

  // Starts open: the pet is anchored to it, and on a first visit the dock is
  // what explains what she is for. Clicking anywhere else dismisses it.
  const [isOpen, setIsOpen] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  /** Her transitory outcome: a write landed, or was refused. */
  const [reaction, setReaction] = useState<PetReaction>(null);
  /** Where she is, so the dock can stay attached to her. */
  const [petBounds, setPetBounds] = useState<PetBounds | null>(null);
  const [dockPos, setDockPos] = useState<DockPlacement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  /**
   * The assistant has asked to run a tool and the server is executing it.
   *
   * There is no push channel for this: `POST /ai/chat` answers once, after the
   * whole think → tool → think loop. But the server does record the assistant
   * turn that carries the tool call *before* running it, so the transcript is a
   * real signal — it just has to be read while the request is still in flight.
   */
  const [toolRunning, setToolRunning] = useState(false);
  const [gaps, setGaps] = useState<AiGaps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  const refreshGaps = useCallback(async () => {
    try {
      const res = await getAiGaps();
      setGaps(res.data);
    } catch {
      // Reminders are a nicety; never surface a toast for them.
      setGaps(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getAiStatus();
        if (cancelled) return;
        setConfigured(status.data.configured);
        const history = await getAiMessages({ limit: 50 });
        if (cancelled) return;
        setMessages(chronological(history.data));
      } catch {
        if (!cancelled) setConfigured(false);
      }
      await refreshGaps();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshGaps]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isSending, isOpen]);

  // R3's reminder delivery does NOT go through the model. The dock renders the
  // gaps straight from `GET /ai/gaps` (the cards above the log), so opening the
  // panel costs nothing. It used to also ask the server to phrase them — one
  // provider call per open, every open — which bought nothing the cards did not
  // already say. The `{ opening: true }` route is still there for a deliberate
  // future trigger; the client no longer calls it on its own.

  /**
   * The dock calls itself a dialog, so it has to behave like one: focus moves
   * in on open, Escape closes it, and the trigger gets focus back on close.
   */
  const closeDock = useCallback(() => {
    setIsOpen(false);
    fabRef.current?.focus();
  }, []);

  useEffect(() => {
    if (isOpen && configured !== false) inputRef.current?.focus();
  }, [isOpen, configured]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDock();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, closeDock]);

  /**
   * Keep the dock attached to her, without ever covering her.
   *
   * The dock is 420px wide and she can be dragged anywhere, so "beside her" is
   * not always possible — near the left edge there is no room, and near the top
   * there is no room above. Rather than guess once and clamp (which parks the
   * panel on top of her), each candidate placement is tested against her box and
   * the first one that actually fits wins:
   *
   *   left of her → right of her → above her → below her → clamped corridor
   *
   * The dock has to stay reachable and its composer must never sit under her
   * clickable area, so overlapping is the last resort rather than an accident.
   */
  useLayoutEffect(() => {
    if (!isOpen || !petBounds) return;
    const dock = dockRef.current;
    if (!dock) return;

    const place = () => {
      const w = dock.offsetWidth;
      const h = dock.offsetHeight;
      if (w < 1 || h < 1) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const GAP = 16;
      const M = 8;
      const me = petBounds;
      const petCenterX = me.x + me.w / 2;
      const petCenterY = me.y + me.h / 2;

      const hits = (left: number, bottom: number) => {
        const top = vh - bottom - h;
        return !(left + w <= me.x || left >= me.x + me.w || top + h <= me.y || top >= me.y + me.h);
      };
      const clampLeft = (l: number) => Math.max(M, Math.min(vw - w - M, l));
      const clampBottom = (b: number) => Math.max(M, Math.min(vh - h - M, b));

      // "side" is which edge of the dock faces her — the tail is drawn there.
      const candidates: [number, number, "left" | "right" | "top" | "bottom"][] = [
        // Beside her, bottom edges aligned with her centre so the panel reads as
        // coming out of her.
        [me.x - GAP - w, vh - petCenterY - h / 2, "right"],
        [me.x + me.w + GAP, vh - petCenterY - h / 2, "left"],
        // Above / below, centred on her.
        [petCenterX - w / 2, vh - me.y + GAP, "bottom"],
        [petCenterX - w / 2, vh - (me.y + me.h) - GAP - h, "top"],
      ];

      // The tail aims at her centre, kept off the rounded corners.
      const aim = (l: number, b: number, side: "left" | "right" | "top" | "bottom") => {
        const INSET = 26;
        if (side === "left" || side === "right") {
          const petTop = me.y + me.h / 2;
          return Math.max(INSET, Math.min(h - INSET, vh - petTop - b));
        }
        const petLeft = petCenterX;
        return Math.max(INSET, Math.min(w - INSET, petLeft - l));
      };

      for (const [left, bottom, side] of candidates) {
        const l = clampLeft(left);
        const b = clampBottom(bottom);
        if (!hits(l, b)) {
          setDockPos({ left: l, bottom: b, side, tail: aim(l, b, side) });
          return;
        }
      }

      // Nowhere is clear (a very small window): park it against the side away
      // from her and accept the overlap rather than push it off screen.
      const onLeftHalf = petCenterX > vw / 2;
      const l = clampLeft(onLeftHalf ? M : vw - w - M);
      const b = clampBottom(vh - petCenterY - h / 2);
      const side = onLeftHalf ? "right" : "left";
      setDockPos({ left: l, bottom: b, side, tail: aim(l, b, side) });
    };

    place();
    // The dock's height changes as the conversation grows and images load.
    const ro = new ResizeObserver(place);
    ro.observe(dock);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [isOpen, petBounds]);

  /**
   * Stable so the pet's reaction timer is not restarted by every render.
   *
   * Passing an inline arrow here re-runs the pet's effect on each render, and
   * since that effect owns a `setTimeout`, a message arriving mid-reaction
   * (any store update while sending) would silently extend the clip.
   */
  const clearReaction = useCallback(() => setReaction(null), []);

  /**
   * While a turn is in flight, watch the transcript for the tool phase.
   *
   * Polling is the honest version of "she is writing right now" for a
   * request/response API: it is driven by a turn the server actually stored,
   * not by a timer guessing that a long request must be a write. It stops as
   * soon as a write turn appears, and the pending request resolves on its own.
   */
  useEffect(() => {
    if (!isSending) {
      setToolRunning(false);
      return;
    }
    let cancelled = false;
    const sameSession = (m: AiMessage) =>
      !m.session_id || m.session_id === currentSessionId();
    const check = async () => {
      try {
        const res = await getAiMessages({ limit: 10 });
        if (cancelled) return;
        const recent = chronological(res.data).filter(sameSession);
        if (recent.some((m) => m.role === "assistant" && parseToolCalls(m.tool_calls) !== null)) {
          setToolRunning(true);
        }
      } catch {
        // A failed poll is not worth surfacing; the turn animates as thinking.
      }
    };
    void check();
    const id = window.setInterval(() => void check(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isSending]);

  /**
   * Click anywhere outside and the dock goes away — she is the handle, but
   * requiring a click on her to dismiss a panel that covers a fifth of the
   * screen is a trap.
   *
   * `pointerdown` rather than `click`: it dismisses on press, before the page
   * underneath reacts, which is what a popover should do. Two presses are
   * ignored: inside the dock (that is use), and on her (she owns the toggle —
   * handling it here too would close and immediately reopen).
   */
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (anchorRef.current?.contains(target)) return;
      if (fabRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (text.length === 0 || isSending) return;

    setError(null);
    setTruncated(false);
    setDraft("");

    // Show the user's own turn immediately; the server stores it either way.
    // The id is tracked so a failure removes exactly this bubble and not the
    // real history that was already loaded.
    const pendingId = -Date.now();
    setMessages((prev) => [
      ...prev,
      {
        id: pendingId,
        user_id: 0,
        session_id: currentSessionId(),
        role: "user",
        content: text,
        tool_calls: null,
        tokens_in: 0,
        tokens_out: 0,
        created_at: new Date().toISOString(),
      },
    ]);
    setIsSending(true);

    try {
      const res = await sendAiMessage(text);
      setTruncated(res.data.truncated);

      const failed = res.data.writes.filter((w) => !w.ok);
      const succeeded = res.data.writes.filter((w) => w.ok);

      if (failed.length > 0) {
        // The tool refused something (an unknown unit, a category still in use).
        // Say so plainly: the assistant's reply is not proof it succeeded.
        setReaction("failed");
        toast.error(failed.map((w) => w.error).filter(Boolean).join("; ") || t("assistant.failed"));
      } else if (succeeded.length > 0) {
        setReaction("done");
        toast.success(t("assistant.writes", { count: succeeded.length }));
      }

      if (succeeded.length > 0) onChanged?.();
      if (res.data.writes.length > 0) await refreshGaps();

      setMessages(chronological((await getAiMessages({ limit: 50 })).data));
    } catch (e: unknown) {
      const message = serverMessage(e) ?? t("assistant.errorTitle");
      setReaction("failed");
      setError(message);
      // Drop only the optimistic bubble: it was not stored.
      setMessages((prev) => prev.filter((m) => m.id !== pendingId));
      void refreshGaps();
    } finally {
      setIsSending(false);
    }
  };

  const handleMarkDay = async (date: string, status: "no_spend" | "partial") => {
    try {
      await markAiNoSpend(date, status);
      toast.success(
        t(status === "no_spend" ? "assistant.markedNoSpend" : "assistant.markedPartial", { date }),
      );
      await refreshGaps();
    } catch (e: unknown) {
      toast.error(serverMessage(e) ?? t("assistant.errorTitle"));
    }
  };

  const dated = visibleMessages(messages);
  const missingDays = gaps?.missing_days ?? [];
  const overdue = gaps?.overdue_subscriptions ?? [];
  const hasReminders = missingDays.length > 0 || overdue.length > 0;

  return (
    <>
      <PetLayer
        isOpen={isOpen}
        thinking={isSending}
        toolRunning={toolRunning}
        reaction={reaction}
        asleep={configured === false}
        label={t(isOpen ? "assistant.close" : "assistant.open")}
        onToggle={handleToggle}
        onClipEnded={clearReaction}
        hasReminders={!isOpen && hasReminders}
        onBounds={setPetBounds}
        buttonRef={fabRef}
      />

      {isOpen && (
        // Outer layer exists so the tail can sit outside the panel: the panel
        // itself needs `overflow: hidden` to clip its rounded corners, which
        // would cut a tail drawn on its own edge.
        <div
          ref={anchorRef}
          className="chat-dock-anchor"
          style={dockPos ? { left: dockPos.left, bottom: dockPos.bottom } : undefined}
        >
          {/* A tail on the edge facing her, so the panel reads as speech coming
              from the character rather than a window that happens to be near. */}
          {dockPos && (
            <span
              className={`chat-dock-tail is-${dockPos.side}`}
              style={{ "--tail": `${dockPos.tail}px` } as React.CSSProperties}
              aria-hidden="true"
            />
          )}
          <section
            ref={dockRef}
            className="chat-dock"
            role="dialog"
            aria-modal="false"
            aria-label={t("assistant.title")}
          >
          <header className="chat-dock-header">
            <Text className="chat-dock-title">{t("assistant.title")}</Text>
            <Button
              variant="ghost"
              size="1"
              onClick={closeDock}
              aria-label={t("assistant.close")}
            >
              <Cross2Icon />
            </Button>
          </header>

          {configured === false ? (
            <div className="chat-dock-unavailable">
              <Text className="chat-dock-unavailable-title">{t("assistant.unavailableTitle")}</Text>
              <Text size="2" className="chat-dock-muted">{t("assistant.unavailableBody")}</Text>
              {onManualEntry && (
                <Button size="2" className="chat-dock-manual" onClick={onManualEntry}>
                  <PlusIcon /> {t("assistant.recordManually")}
                </Button>
              )}
            </div>
          ) : (
            <>
              {hasReminders && (
                <div className="chat-dock-reminders">
                  <Text className="chat-dock-reminders-label">{t("assistant.reminders")}</Text>
                  {missingDays.map((d) => (
                    <div key={d.date} className="chat-dock-reminder">
                      <span>{t("assistant.missingDay", { date: d.date })}</span>
                      <Flex gap="1">
                        <Button size="1" variant="soft" onClick={() => handleMarkDay(d.date, "no_spend")}>
                          {t("assistant.markNoSpend")}
                        </Button>
                        <Button size="1" variant="ghost" onClick={() => handleMarkDay(d.date, "partial")}>
                          {t("assistant.markPartial")}
                        </Button>
                      </Flex>
                    </div>
                  ))}
                  {overdue.map((o) => (
                    <div key={o.subscription_id} className="chat-dock-reminder is-overdue">
                      <span>{t("assistant.overdue", { name: o.name, date: o.end_date })}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="chat-dock-log" aria-live="polite" aria-relevant="additions text">
                {dated.length === 0 && !isSending && (
                  <Text size="2" className="chat-dock-muted">{t("assistant.empty")}</Text>
                )}

                {dated.map((m) => (
                  <div key={m.id} className={`chat-dock-bubble is-${m.role}`}>
                    {/* Only the assistant's turns are markdown: the model emits it
                        unbidden, while the user's own text is literal — "* 2" in a
                        note should not become italics. */}
                    {m.role === "assistant"
                      ? <MiniMarkdown text={m.content ?? ""} />
                      : m.content}
                  </div>
                ))}

                {isSending && (
                  <div className="chat-dock-bubble is-assistant is-pending">
                    <UpdateIcon className="chat-dock-spin" /> {t("assistant.thinking")}
                  </div>
                )}

                {truncated && (
                  <Text size="1" className="chat-dock-warning">{t("assistant.truncated")}</Text>
                )}
                {error && <Text size="1" className="chat-dock-error">{error}</Text>}

                <div ref={endRef} />
              </div>

              <form
                className="chat-dock-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
              >
                <input
                  ref={inputRef}
                  className="chat-dock-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label={t("assistant.inputLabel")}
                  disabled={isSending}
                />
                <Button className="app-primary" type="submit" disabled={isSending || draft.trim().length === 0}>
                  <PaperPlaneIcon />
                </Button>
              </form>
            </>
          )}
          </section>
        </div>
      )}
    </>
  );
};

export default ChatDock;
