/**
 * Open-the-assistant signal (owner fix, 2026-11).
 *
 * The smart employee (ChatWidget) is mounted once in the locale
 * layout; other chrome — the MobileNav Support entry, future CTAs —
 * opens it by dispatching this window event instead of owning chat
 * state. ChatWidget listens and opens; nothing else changes.
 */
export const OPEN_CHAT_EVENT = "astralium:open-chat";

export function openChat(): void {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT));
  } catch { /* non-browser context — nothing to open */ }
}
