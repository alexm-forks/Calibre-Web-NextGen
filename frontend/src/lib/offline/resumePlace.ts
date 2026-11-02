// Where a book opens: the rule, kept free of browser APIs so node can test it
// (frontend/unit/resumePlace.test.ts).
//
// Three sources, in order of authority:
//   1. an unsent position from this device (the outbox): newer than anything
//      this device has told the server, so it wins;
//   2. the server's saved place, when the server answered: it already holds
//      everything this device sent, plus any newer reading in another tab;
//   3. this device's last place, when the server can't be reached.

export interface LocalPlace {
  bookmark: string;
  observedAt: string;
}

export interface ResumeInputs {
  /** The server's answer, or `undefined` when it could not be reached. */
  server?: { bookmark: string | null } | undefined;
  /** An unsent position for this book from the outbox. */
  pending?: LocalPlace | null;
  /** The last place reached on this device. */
  local?: LocalPlace | null;
}

export function pickResumeBookmark({ server, pending, local }: ResumeInputs): string | null {
  if (pending?.bookmark) return pending.bookmark;
  if (server !== undefined) return server.bookmark ?? null;
  return local?.bookmark ?? null;
}
