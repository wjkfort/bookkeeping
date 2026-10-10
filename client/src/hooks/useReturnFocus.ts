import { useEffect, useRef } from "react";

/**
 * Give focus back to whatever opened a dialog.
 *
 * Radix returns focus to `Dialog.Trigger` automatically — but these dialogs are
 * opened by ordinary Buttons (a `+`, a paging control, a row action), so Radix
 * has no trigger ref and drops focus to `<body>`. Measured on four dialogs: Esc
 * closed them and focus went nowhere, which strands a keyboard user at the top
 * of the document.
 */
export const useReturnFocus = (open: boolean): void => {
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      const active = document.activeElement;
      if (active instanceof HTMLElement) opener.current = active;
      return;
    }
    // Radix moves focus to <body> synchronously while closing, so defer past
    // it. Restoring unconditionally is safe here: a dialog that opens on top of
    // this one never closes this one, and when the nested dialog closes its own
    // opener is the control inside the parent.
    const id = window.setTimeout(() => opener.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);
};
