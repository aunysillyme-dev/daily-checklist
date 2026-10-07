import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseState, type State, type Task} from '../src/model.ts';

const task: Task = {id:'test-1', title:'A task', date:'2026-10-07', notes:'Notes', category:'Work', subcategory:'Admin', urgent:true, time:'', done:false, created:1};
const KEY = 'auny.daily-checklist.v1';
const CLIENT = '111-aaa.apps.googleusercontent.com';
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

async function api() {
  const model = await import('../src/model.ts');
  const storage = await import('../src/storage.ts');
  const google = await import('../src/google.ts');
  return {model, storage, google};
}

function memory() {
  const box = {
    raw: null as string | null,
    getItem() { return box.raw; },
    setItem(_key: string, value: string) { box.raw = value; },
    removeItem() { box.raw = null; },
  };
  return box;
}

function mutex() {
  let tail: Promise<void> = Promise.resolve();
  return function lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
}

function installGis(options: {
  revoke?: (token: string, cb: (response?: {successful?: boolean; error?: string}) => void) => void;
  onToken?: (callback: (response: {access_token?: string; expires_in?: number; scope?: string; error?: string}) => void, error: () => void) => void;
  scope?: string;
}) {
  Object.assign(globalThis, {window: {google: {accounts: {oauth2: {
    initTokenClient(client: {scope: string; callback: (response: {access_token?: string; expires_in?: number; scope?: string; error?: string}) => void; error_callback: () => void}) {
      assert.equal(client.scope, CAL_SCOPE);
      return {requestAccessToken() {
        if (options.onToken) options.onToken(client.callback, client.error_callback);
        else client.callback({access_token: 'token-1', expires_in: 3600, scope: options.scope || CAL_SCOPE});
      }};
    },
    revoke: options.revoke ?? ((_token, cb) => cb({successful: true})),
  }}}}});
}

test('whitespace edit leaves saved data unchanged', async () => {
  const {model, storage} = await api();
  const store = memory();
  const original: State = {version: 1, tasks: [task], categories: [{name: 'Work', children: ['Admin']}]};
  const raw = JSON.stringify(original);
  store.setItem(KEY, raw);
  assert.throws(() => model.applyTaskEdit(task, {title: '   ', date: task.date, notes: 'changed', category: task.category, subcategory: task.subcategory, urgent: task.urgent, time: ''}), /title/i);
  assert.throws(() => model.requireCategoryName('   '), /category/i);
  assert.throws(() => parseState(JSON.stringify({...original, categories: [{name: '   ', children: []}]})));
  const invalid: State = {...original, tasks: [{...task, title: '   '}]};
  const result = await storage.commitChecked(store, KEY, raw, invalid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'invalid');
  assert.equal(store.getItem(KEY), raw);
});

test('unknown category stays selectable and is preserved when notes change', async () => {
  const {model} = await api();
  const choices = model.categoryChoices(['Personal', 'Work'], 'Imported');
  assert.ok(choices.includes('Imported'));
  assert.equal(choices[0], '');
  const edited = model.applyTaskEdit({...task, category: 'Imported'}, {title: task.title, date: task.date, notes: 'new note', category: 'Imported', subcategory: task.subcategory, urgent: false, time: ''});
  assert.equal(edited.category, 'Imported');
  assert.equal(edited.notes, 'new note');
});

test('two tabs that start from the same snapshot cannot overwrite each other', async () => {
  const {storage} = await api();
  const store = memory();
  const lock = mutex();
  const a: State = {version: 1, tasks: [task], categories: []};
  const b: State = {version: 1, tasks: [{...task, id: 'test-2', title: 'Other'}], categories: []};
  const [first, second] = await Promise.all([
    storage.commitChecked(store, KEY, null, a, lock),
    storage.commitChecked(store, KEY, null, b, lock),
  ]);
  const saved = parseState(store.getItem(KEY)!);
  assert.equal(saved.tasks.length, 1);
  assert.equal(first.ok !== second.ok, true);
  assert.equal(saved.tasks[0].id, first.ok ? 'test-1' : 'test-2');
  const again = await storage.commitChecked(store, KEY, null, b);
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.reason, 'conflict');
  assert.equal(parseState(store.getItem(KEY)!).tasks[0].id, saved.tasks[0].id);
  assert.deepEqual(storage.adoptExternal(null, {version: 1, tasks: [], categories: []}), {ok: true, state: {version: 1, tasks: [], categories: []}, base: null});
});

test('nonempty saved public client id overrides the baked id', async () => {
  const {google} = await api();
  const baked = '111-aaa.apps.googleusercontent.com';
  const saved = '222-bbb.apps.googleusercontent.com';
  assert.equal(google.resolveClientId(baked, saved), saved);
  assert.equal(google.resolveClientId(baked, '   '), baked);
  assert.equal(google.resolveClientId(baked, null), baked);
  assert.equal(google.shouldDropGoogleSession(baked, saved, true), true);
  assert.equal(google.shouldDropGoogleSession(saved, saved, true), false);
  assert.equal(google.shouldDropGoogleSession(baked, saved, false), false);
});

test('stale read after a successful write does not replace newer data', async () => {
  const {google} = await api();
  installGis({});
  await google.authorize(CLIENT, CAL_SCOPE);
  const previous = globalThis.fetch;
  let release: () => void = () => undefined;
  const hold = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async () => {
    await hold;
    return jsonResponse({items: [{id: 'event-1', summary: 'Old'}]});
  };
  try {
    const readMark = google.stamp();
    const pending = google.events('primary', '2026-10-07');
    const written = {summary: 'Updated'};
    google.invalidateGeneration();
    assert.equal(google.isFresh(readMark), false);
    release();
    await assert.rejects(pending, google.isStale);
    assert.equal(google.acceptIfFresh(readMark, {summary: 'Old'}), undefined);
    assert.equal(written.summary, 'Updated');
  } finally {
    globalThis.fetch = previous;
    await google.disconnect(20);
  }
});

test('a late response from an old account cannot repopulate data', async () => {
  const {google} = await api();
  installGis({});
  await google.authorize(CLIENT, CAL_SCOPE);
  const previous = globalThis.fetch;
  let release: () => void = () => undefined;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let requested = '';
  globalThis.fetch = async (input) => {
    requested = String(input);
    await hold;
    return jsonResponse({items: [{id: 'old', summary: 'Secret'}]});
  };
  try {
    const readMark = google.stamp();
    const pending = google.calendars();
    google.invalidateAccount();
    let repopulated: unknown;
    release();
    try { repopulated = await pending; } catch (error) { assert.equal(google.isStale(error), true); }
    assert.equal(repopulated, undefined);
    assert.equal(google.acceptIfFresh(readMark, [{id: 'old'}]), undefined);
    assert.equal(google.connected(), false);
    assert.match(requested, /\/calendar\/v3\//);
  } finally {
    globalThis.fetch = previous;
    await google.disconnect(20);
  }
});

test('a delayed calendar result does not return after disconnect', async () => {
  const {google} = await api();
  installGis({});
  await google.authorize(CLIENT, CAL_SCOPE);
  const previous = globalThis.fetch;
  let release: () => void = () => undefined;
  const hold = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async () => {
    await hold;
    return jsonResponse({items: [{id: 'cal', summary: 'Old'}]});
  };
  try {
    const pending = google.calendars();
    const done = google.disconnect(30);
    release();
    await assert.rejects(pending, google.isStale);
    const result = await done;
    assert.equal(result.cleared, true);
    assert.equal(google.connected(), false);
  } finally {
    globalThis.fetch = previous;
    await google.disconnect(20);
  }
});

test('a canceled sign-in keeps an existing calendar session', async () => {
  const {google} = await api();
  installGis({});
  await google.authorize(CLIENT, CAL_SCOPE);
  assert.equal(google.connected(), true);
  installGis({onToken: (_callback, error) => error()});
  const outcome = await google.authorize(CLIENT, CAL_SCOPE);
  assert.equal(outcome.restored, true);
  assert.equal(google.connected(), true);
  await google.disconnect(20);
});

test('a canceled sign-in with no session asks to reconnect', async () => {
  const {google} = await api();
  await google.disconnect(20);
  installGis({onToken: (_callback, error) => error()});
  await assert.rejects(() => google.authorize(CLIENT, CAL_SCOPE), /reconnect|closed/i);
  assert.equal(google.connected(), false);
});

test('revoke error callback clears the local session without claiming revocation', async () => {
  const {google} = await api();
  installGis({revoke: (_token, callback) => callback({successful: false, error: 'revoke_failed'})});
  await google.authorize(CLIENT, CAL_SCOPE);
  assert.equal(google.connected(CAL_SCOPE), true);
  const result = await google.disconnect(50);
  assert.equal(result.cleared, true);
  assert.equal(result.revoked, false);
  assert.match(result.error || '', /revoke_failed|may still be active/i);
  assert.equal(google.connected(CAL_SCOPE), false);
});

test('revoke timeout does not claim the grant was revoked', async () => {
  const {google} = await api();
  installGis({revoke: () => undefined});
  await google.authorize(CLIENT, CAL_SCOPE);
  const result = await google.disconnect(30);
  assert.equal(result.cleared, true);
  assert.equal(result.revoked, false);
  assert.match(result.error || '', /may still be active/i);
  assert.equal(google.connected(), false);
});
