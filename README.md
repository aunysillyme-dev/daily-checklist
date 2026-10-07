# Daily checklist

A personal calendar and checklist in the [aunysillyme.com](https://aunysillyme.com) brand: cream, navy, orange, teal, Inter and the original lighthouse mark.

## What and why

Pick a date, add tasks, choose categories and subcategories, mark urgency, attach notes and a time, edit tasks and check them off. The month view shows open, completed and urgent days. An inbox holds undated tasks. All tasks can be searched, filtered and paginated. The layout adapts to phones.

Every checklist task stays in this browser. Sign in with Google reads appointments from a calendar you choose. It uses only `https://www.googleapis.com/auth/calendar.readonly`. Per-task schedule opens an editable Google Calendar draft that you save there. Calendar export downloads an `.ics` file. This app does not write calendar events and has no server.

## Trigger

Open the app to load local tasks. Use **Sign in with Google** to authorize the current session. After sign-in, choose a calendar. The agenda loads for the selected day and again when you change the day, change the calendar, or press **Refresh Google Calendar**. No background jobs or unattended writes exist. Supporting browsers also expose the read-only `read_checklist` WebMCP tool for the same local checklist. Browser runtime validation is UNVERIFIED when WebMCP is unavailable.

Publication is manual through Sites. Source is saved in `aunysillyme-dev/daily-checklist` and the Site source repository. Site ID: `appgprj_6ac6ac909e708191b722e07e6ad89935`. Origin: `https://auny-daily-checklist.apt-ring-6682.chatgpt.site`. New Sites are owner-private by default.

## Invocation chain

`index.html` loads `src/main.ts`, which renders the app and delegates user actions. `src/model.ts` validates task edits, categories, dates, sorting and calendar files. `src/storage.ts` validates the next checklist and commits it only when the stored bytes still match the copy this tab started from. `src/google.ts` authorizes with Google Identity Services and reads the Calendar API from the browser.

Publishing: the Sites `site-workflow.mjs` helper runs checks and a Vite build, commits and pushes the exact source to the Site repository, then packages `dist` with `.openai/hosting.json`. Native Sites save-and-deploy publishes that archive; deployment status must report `succeeded`. The same source commit is pushed to the GitHub repository.

## Dependencies and Google setup

- Node.js 22+, npm, TypeScript and Vite. Install versions are locked in `package-lock.json`.
- Sites hosting, with `static.directory: "dist"` in `.openai/hosting.json`.
- Inter loads from Google Fonts. The lighthouse asset is bundled locally.
- Google Calendar requires a **Web application OAuth client**, with the Site origin above registered as an authorized JavaScript origin. The dedicated client is **Auny Daily Checklist** in project `auny-workspace-mcp`. Local previews need their own authorized origin before Google sign-in can succeed.
- Enable the **Google Calendar API** in the Google Cloud project. Configure the consent screen and include intended accounts as test users when the app is in Testing. Do not enable any other Google API for this app.
- Set `VITE_GOOGLE_CLIENT_ID` when building. Its public value is `277211906106-u9rtu54m0tdm3tonig76fc63pi72t26m.apps.googleusercontent.com`. Users press **Sign in with Google**; no client-ID form is shown. A client secret is never required, accepted or embedded.
- Sign-in requests `https://www.googleapis.com/auth/calendar.readonly` only. There is no backend and no other scope.
- The dedicated OAuth client exists and the Calendar API is enabled (verified in Google Cloud on 2026-10-07). An authenticated agenda roundtrip is **UNVERIFIED pending user consent**. Google verification requirements for general public access remain subject to the existing project consent configuration. Draft links and `.ics` export do not need OAuth.

## Reads

- `localStorage["auny.daily-checklist.v1"]`: local task backup and categories.
- With permission: the Google Calendar list and the selected day's events.
- Checklist tasks are never uploaded on sign-in.

## Writes

- Local changes are validated, then saved to this browser. A blank title or a blank category name is rejected and the previous saved bytes stay in place.
- On HTTPS, including the GPT Site and `localhost`, saves take a `navigator.locks` lock named `auny-daily-checklist`. Inside the lock the app compares the current stored text with the text this tab last loaded. If another tab wrote first, this tab does not overwrite it. It adopts the saved checklist and asks you to retry.
- Browsers without Web Locks, or pages that are not a secure context, still compare the stored text before writing. Two saves that both read the same text before either write can still overwrite each other. Avoid editing the same checklist in two tabs unless the browser provides Web Locks.
- Downloadable JSON backups include local tasks and categories. Import merges by local task ID without overwriting existing IDs.
- Schedule opens `https://calendar.google.com/calendar/render` as an editable draft. `.ics` import is a separate copy and does not track later task changes.
- Google access tokens live only in memory and disappear on reload. No tokens, client secrets, personal task content or calendar data are committed to GitHub.
- Disconnect clears the local session immediately, then waits for Google's revoke callback. The app says the grant was revoked only when that callback succeeds. An error or a timeout says the grant may still be active.

## The closed loop

Local changes succeed only after browser storage accepts the validated checklist. A late Calendar response from an older sign-in, disconnect, or calendar selection is ignored. Disconnect clears the agenda. A canceled sign-in keeps a still-valid session when one exists. Otherwise it clears the session and asks you to sign in again.

What watches it: the Site publishing operation reports build and deployment status. There is no scheduled deployment monitor. **Nothing** monitors browser storage, Google authorization or Calendar API availability. The user sees errors as in-app status messages and can export a local backup. Report failures through the repository's Issues tab with the action, browser and error message. Never include tokens or private task content.

## Failure modes

- Browser data cleared or private browsing: local tasks disappear. Download backups regularly.
- Invalid or full storage: failed saves are reported and the previous readable backup is left untouched. Unreadable existing storage is preserved until you download it and explicitly reset it.
- Missing client ID or unregistered origin: sign-in needs configuration. Local tasks, draft links and calendar export still work.
- Expired or denied consent, or a blocked pop-up: sign in again. Local tasks remain.
- Calendar API disabled or account not a test user: configure the Google Cloud project. Authenticated verification is still pending.
- Network failure while reading the agenda: the local checklist stays saved. Refresh Google Calendar before retrying. Nothing is retried automatically.
- Multiple browser tabs: a newer save wins. The other tab adopts it and asks for a retry. Without Web Locks, simultaneous writes can still race.
- Publishing fails: inspect the Sites deployment failure message and rebuild the corrected source. Do not redeploy a failed artifact unchanged.

## Run and verify by hand

```sh
npm ci
npm run check
npm test
python3 tests/brand_check.py
python3 tests/calendar_only_check.py
npm run build
npm run preview -- --port 4174
```

Open `http://127.0.0.1:4174`. Verify create, edit, complete, a second date, notes, urgency and categories on a phone-width window and on a desktop window. Reload and check persistence. Export and import a backup. Open a schedule draft and an `.ics` export. Enter a title of spaces and confirm the saved checklist does not change. Edit a task whose category is not in Settings and confirm that category remains when the notes change.

For Google verification, after granting consent on the published Site: sign in, choose a calendar and day, and compare the agenda with Google Calendar. Refresh, switch calendars, disconnect, and confirm the agenda clears. If revoke fails, the message says the grant may still be active. **Authenticated verification is pending owner consent.**

Publication from a local checkout: run `node <Sites-plugin-root>/scripts/site-workflow.mjs --project-id appgprj_6ac6ac909e708191b722e07e6ad89935` and provide a native Sites repository credential on hidden stdin, checks/build command arrays, and an absolute archive path. Pass the returned exact commit SHA and archive to native `save_version_and_deploy_private`. Poll its deployment ID to success. Never put the credential in shell arguments or files.

Rollback: before replacing a live version, retain its version ID. Deploy that saved version through native Sites if rollback is needed. This first publication has no prior live version. Local browser data is not affected by a rollback.

## Source of truth

This repository is the source for the app. `package-lock.json` fixes dependency versions. `.openai/hosting.json` identifies the Site and public output directory. The Sites workflow and native deployment tools define publishing. Local tasks come from browser storage. Appointments come from Google Calendar after sign-in. Brand values come from the live aunysillyme.com system. No analytics or advertising code is carried over.

Google sign-in follows the [Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model). Calendar reads follow the [Calendar events list](https://developers.google.com/calendar/api/v3/reference/events/list). Publishing follows the installed Sites building and hosting skills. The Google documentation examples are Apache 2.0. This integration was written independently around those API contracts.
