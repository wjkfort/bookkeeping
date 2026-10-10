import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Flex, Text } from "@radix-ui/themes";
import { ChatBubbleIcon, Cross2Icon, PaperPlaneIcon, PlusIcon, UpdateIcon } from "@radix-ui/react-icons";
import {
  getAiStatus,
  getAiMessages,
  currentSessionId,
  sendAiMessage,
  openAiConversation,
  getAiGaps,
  markAiNoSpend,
} from "../../api";
import type { AiGaps, AiMessage } from "../../types";
import { useToast } from "../ui/toastContext";
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

const ChatDock: React.FC<ChatDockProps> = ({ onChanged, onManualEntry }) => {
  const { t } = useTranslation();
  const toast = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [gaps, setGaps] = useState<AiGaps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // Guards the one-time opening turn so it does not fire on every render or
  // re-open: it must happen once per session, not once per click.
  const openedRef = useRef(false);
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

  /**
   * R3 delivery: when the panel is first opened, ask the server to open the
   * conversation with the outstanding gaps. Skipped when a conversation already
   * exists, so it does not repeat on every visit.
   */
  const maybeOpenConversation = useCallback(async () => {
    if (openedRef.current) return;
    openedRef.current = true;
    if (messages.length > 0) return;

    try {
      const res = await openAiConversation();
      if (res.data.reply) {
        setMessages(chronological((await getAiMessages({ limit: 50 })).data));
      }
      if (res.data.writes.length > 0) onChanged?.();
    } catch {
      // Nothing to greet with is not an error worth showing.
    }
  }, [messages.length, onChanged]);

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

  const handleToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && configured !== false) void maybeOpenConversation();
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
        toast.error(failed.map((w) => w.error).filter(Boolean).join("; ") || t("assistant.failed"));
      } else if (succeeded.length > 0) {
        toast.success(t("assistant.writes", { count: succeeded.length }));
      }

      if (succeeded.length > 0) onChanged?.();
      if (res.data.writes.length > 0) await refreshGaps();

      setMessages(chronological((await getAiMessages({ limit: 50 })).data));
    } catch (e: unknown) {
      const message = serverMessage(e) ?? t("assistant.errorTitle");
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
      <button
        type="button"
        ref={fabRef}
        className={`chat-dock-fab${isOpen ? " is-open" : ""}`}
        onClick={handleToggle}
        aria-label={t(isOpen ? "assistant.close" : "assistant.open")}
        aria-expanded={isOpen}
        title={t(isOpen ? "assistant.close" : "assistant.open")}
      >
        {isOpen ? <Cross2Icon /> : <ChatBubbleIcon />}
        {!isOpen && hasReminders && (
          <span className="chat-dock-badge" aria-hidden="true" />
        )}
      </button>

      {isOpen && (
        <section
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
                    {m.content}
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
                  placeholder={t("assistant.placeholder")}
                  aria-label={t("assistant.placeholder")}
                  disabled={isSending}
                />
                <Button className="app-primary" type="submit" disabled={isSending || draft.trim().length === 0}>
                  <PaperPlaneIcon />
                </Button>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
};

export default ChatDock;
