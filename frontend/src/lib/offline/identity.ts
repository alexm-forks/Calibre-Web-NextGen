// The last signed-in identity, so the installed app can start without a
// connection. Used only when /api/v1/auth/me cannot be reached at all; any
// answer from the server (including "signed out") replaces or clears it.
import type { Me } from '../api';

const KEY = 'cwng.offline.me';

export function rememberIdentity(me: Me | null): void {
  try {
    if (me && !me.role?.anonymous) localStorage.setItem(KEY, JSON.stringify(me));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage refused (private mode): the app just won't start offline.
  }
}

export function lastKnownIdentity(): Me | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const me = JSON.parse(raw) as Me;
    return typeof me?.id === 'number' && me.role ? me : null;
  } catch {
    return null;
  }
}
