/**
 * Identities used by the watch party.
 *
 * partyUserId  — who you are INSIDE A ROOM (member list, host, chat, call peers). It is unique per
 *                browser tab, even for the same account. Otherwise the same account opened on a
 *                laptop and a phone (or two tabs) would look like ONE person to the server: the second
 *                device replaces the first, and call signalling from "yourself" is ignored.
 *                Kept in sessionStorage so a refresh keeps the same identity.
 *
 * ownerUserId  — who OWNS an upload (decides who may delete it). Stable for real accounts; demo-mode
 *                sessions (which all share the literal id "demo") fall back to the per-tab id.
 */
interface MaybeUser {
  id?: string | number;
}

const TAB_KEY = 'tamilflix_party_tab';
let memoryTabId: string | null = null;

function tabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage blocked: keep one id for this page load
    return (memoryTabId ??= Math.random().toString(36).slice(2, 10));
  }
}

function accountId(user: MaybeUser | null | undefined): string {
  const raw = user?.id == null ? '' : String(user.id);
  return raw && raw !== 'demo' ? raw : '';
}

export function partyUserId(user: MaybeUser | null | undefined): string | undefined {
  if (!user) return undefined;
  return `${accountId(user) || 'guest'}~${tabId()}`;
}

export function ownerUserId(user: MaybeUser | null | undefined): string | undefined {
  if (!user) return undefined;
  return accountId(user) || `guest~${tabId()}`;
}
