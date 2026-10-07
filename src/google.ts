export const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export type Calendar = { id: string; summary: string; primary?: boolean };
export type CalendarEvent = { id: string; summary?: string; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string }; htmlLink?: string };
type TokenResponse = { access_token?: string; expires_in?: number; scope?: string; error?: string };
type RevokeResponse = { successful?: boolean; error?: string };
type OAuth = {
  initTokenClient(o: { client_id: string; scope: string; callback: (r: TokenResponse)=>void; error_callback: ()=>void }): { requestAccessToken(o: { prompt: string }): void };
  revoke(token: string, cb: (response?: RevokeResponse)=>void): void;
};
type Host = { google?: { accounts: { oauth2: OAuth } }; document?: Document };
declare global { interface Window { google?: { accounts: { oauth2: OAuth } } } }

export class StaleError extends Error {
  constructor() { super('This Google Calendar response is out of date.'); this.name = 'StaleError'; }
}
export function isStale(error: unknown) { return error instanceof Error && error.name === 'StaleError'; }

let token = '', expiry = 0, generation = 0, accountGeneration = 0, granted = new Set<string>();
let loading: Promise<void> | undefined;
let signInQueue: Promise<void> = Promise.resolve();

function host(): Host {
  const root = globalThis as typeof globalThis & { window?: Host; document?: Document; google?: Host['google'] };
  return {google: root.window?.google ?? root.google, document: root.window?.document ?? root.document};
}
function bumpSession() { accountGeneration += 1; generation += 1; }
export function stamp() { return generation; }
export function isFresh(mark: number) { return mark === generation; }
export function invalidateGeneration() { generation += 1; }
export function invalidateAccount() { token = ''; expiry = 0; granted = new Set(); bumpSession(); }
export function acceptIfFresh<T>(mark: number, value: T): T | undefined { return mark === generation ? value : undefined; }
export function connected(scope = CAL_SCOPE) { return !!token && Date.now() < expiry && granted.has(scope); }
export function resolveClientId(baked: string, saved: string | null) {
  const chosen = (saved ?? '').trim();
  return chosen || baked;
}
export function shouldDropGoogleSession(previousClientId: string, nextClientId: string, isConnected: boolean) {
  return isConnected && previousClientId !== nextClientId;
}

export function prepareGoogle() {
  if (host().google) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const doc = host().document;
    if (!doc) { loading = undefined; reject(new Error('Google sign-in could not load. Check your connection.')); return; }
    const script = doc.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { loading = undefined; script.remove(); reject(new Error('Google sign-in could not load. Check your connection.')); };
    doc.head.append(script);
  });
  return loading;
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = signInQueue.then(fn, fn);
  signInQueue = run.then(() => undefined, () => undefined);
  return run;
}

export function authorize(clientId: string, scope = CAL_SCOPE): Promise<{restored: boolean}> {
  if (scope !== CAL_SCOPE) return Promise.reject(new Error('Only Google Calendar read access is requested.'));
  return enqueue(() => new Promise((resolve, reject) => {
    const oauth = host().google?.accounts.oauth2;
    if (!oauth) { reject(new Error('Google sign-in is still loading. Try again in a moment.')); return; }
    const previous = {token, expiry, granted: new Set(granted)};
    const restoreOrClear = (message: string) => {
      const usable = !!previous.token && Date.now() < previous.expiry && previous.granted.has(CAL_SCOPE);
      generation += 1;
      if (usable) { token = previous.token; expiry = previous.expiry; granted = previous.granted; resolve({restored: true}); return; }
      token = ''; expiry = 0; granted = new Set(); accountGeneration += 1;
      reject(new Error(message));
    };
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: CAL_SCOPE,
      callback: response => {
        if (response.error || !response.access_token) { restoreOrClear('Google access was not granted. Sign in with Google to reconnect.'); return; }
        const scopes = new Set((response.scope || '').split(/\s+/).filter(Boolean));
        if (!scopes.has(CAL_SCOPE)) { token = ''; expiry = 0; granted = new Set(); bumpSession(); reject(new Error('Google Calendar read access was not granted. Sign in with Google to reconnect.')); return; }
        token = response.access_token;
        expiry = Date.now() + Math.max(0, Number(response.expires_in || 3600) - 60) * 1000;
        granted = scopes;
        bumpSession();
        resolve({restored: false});
      },
      error_callback: () => restoreOrClear('The sign-in window was closed. Sign in with Google to reconnect.'),
    });
    client.requestAccessToken({prompt: ''});
  }));
}

export function disconnect(timeoutMs = 4000): Promise<{cleared: boolean; revoked: boolean; error?: string}> {
  const old = token;
  token = ''; expiry = 0; granted = new Set(); bumpSession();
  if (!old) return Promise.resolve({cleared: true, revoked: false});
  const revoke = host().google?.accounts.oauth2.revoke;
  if (!revoke) return Promise.resolve({cleared: true, revoked: false, error: 'Google sign-in is unavailable. The Google grant may still be active.'});
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: {cleared: boolean; revoked: boolean; error?: string}) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => finish({cleared: true, revoked: false, error: 'Revocation timed out. The Google grant may still be active.'}), timeoutMs);
    try {
      revoke(old, response => {
        if (response?.error || response?.successful === false) finish({cleared: true, revoked: false, error: `${response?.error || 'revoke_failed'}. The Google grant may still be active.`});
        else finish({cleared: true, revoked: true});
      });
    } catch (error) {
      finish({cleared: true, revoked: false, error: `${error instanceof Error ? error.message : 'revoke_failed'}. The Google grant may still be active.`});
    }
  });
}

async function request<T>(url: URL, mark: number, account: number): Promise<T> {
  if (!url.pathname.startsWith('/calendar/')) throw new Error('This app only reads Google Calendar.');
  if (mark !== generation || account !== accountGeneration) throw new StaleError();
  if (!token || Date.now() >= expiry) throw new Error('Google session expired. Sign in with Google to reconnect.');
  let response: Response;
  try { response = await fetch(url, {headers:{Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(20000)}); }
  catch { if (mark !== generation || account !== accountGeneration) throw new StaleError(); throw new Error('Google Calendar could not be reached. Your local checklist is saved.'); }
  if (mark !== generation || account !== accountGeneration) throw new StaleError();
  if (response.status === 401) { token = ''; expiry = 0; granted = new Set(); throw new Error('Google session expired. Sign in with Google to reconnect.'); }
  if (!response.ok) throw new Error(response.status === 403 ? 'Google Calendar denied access. Check that the Calendar API is enabled for this account.' : `Google Calendar could not complete the request (${response.status}). Refresh before retrying.`);
  return response.json() as Promise<T>;
}
async function allPages<T>(url: URL): Promise<T[]> {
  const mark = generation, account = accountGeneration, result: T[] = [];
  let next = '';
  do {
    if (next) url.searchParams.set('pageToken', next);
    const page = await request<{items?: T[]; nextPageToken?: string}>(url, mark, account);
    result.push(...(page.items || []));
    next = page.nextPageToken || '';
  } while (next);
  if (mark !== generation || account !== accountGeneration) throw new StaleError();
  return result;
}
export function calendars() { return allPages<Calendar>(new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250')); }
export function events(calendarId: string, date: string) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.search = new URLSearchParams({timeMin:start.toISOString(), timeMax:end.toISOString(), singleEvents:'true', orderBy:'startTime', maxResults:'2500'}).toString();
  return allPages<CalendarEvent>(url);
}
