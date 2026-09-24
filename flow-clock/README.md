# Flow Clock — Flow Autobody (trial)

Tap-to-clock for the workshop floor. Reusable NFC key cards (1–100) are linked
to jobs by reception; techs tap a card with their phone to clock on/off the job
or send a supplement (photo, video, voice note, typed note) to the office.

- **Stack:** React + Vite + supabase-js, hosted on Netlify, Supabase for the
  database, realtime and file storage.
- **Lives in:** the `flow-clock/` folder of this repo (the repo root still holds
  the separate stock scanner page).

| URL | Who | What |
| --- | --- | --- |
| `/clock` | techs (office NFC tag) | Clock in / out for the day. Clocking out also clocks you off your job. |
| `/t/<card>` | techs (key card NFC / QR) | Job details, **Clock On** (pick task), **Clock Off**, **Add Supplement**, list of supplements. |
| `/reception` | admin | Create / edit jobs, assign a card to a job, release a card on delivery, cards in use / free. |
| `/board` | admin | Live: who's in, who's on which job & task and for how long, supplements inbox, hours per job. |
| `/cards` | admin | Printable A4 QR sheet for cards 1–100 (plus the office CLOCK tag). |
| `/` | anyone | Menu + "type a card number" backup. |

## 1. Supabase setup

1. Create a project at <https://supabase.com> (region: **Sydney**).
2. **SQL Editor → New query**: paste all of
   `supabase/migrations/20260924000000_flow_clock.sql` and **Run**. This creates
   the tables, the security rules, the functions the app calls, the
   `supplements` storage bucket (public, 50 MB file limit) and turns on
   realtime for the board.
3. New query again: paste `supabase/seed.sql` and **Run**. This adds cards
   1–100, 5 dummy techs, a `Reception` admin and 10 dummy jobs (8 of them
   already on cards 1–8).

   | User | Role | PIN |
   | --- | --- | --- |
   | Dave, Mick, Sarah, Tomas, Jess | tech | `1234` |
   | Reception | admin | `9999` |

4. **Project Settings → API**: copy the **Project URL** and the **anon public**
   key for the next step.

Managing people (SQL Editor, for the trial):

```sql
-- add a tech
insert into techs(name, pin_hash, role)
values ('Liam', extensions.crypt('4821', extensions.gen_salt('bf')), 'tech');
-- change a PIN
update techs set pin_hash = extensions.crypt('5555', extensions.gen_salt('bf')) where name = 'Dave';
-- make someone an admin / deactivate someone
update techs set role = 'admin' where name = 'Sarah';
update techs set active = false where name = 'Mick';
-- before go-live, remove the dummy data
delete from jobs where job_number between 'J1001' and 'J1010';
```

### How security works

- The anon key is public (it's in the browser). With it, people can **read**
  jobs, cards, time and supplements, and see tech **names** — but never PIN
  hashes, and they **can't write anything directly**.
- Every write goes through a Postgres function that checks a session token.
  A token is only issued after picking a name and entering the right 4-digit
  PIN. 5 wrong PINs locks that name for 5 minutes. Admin functions also check
  the role.
- Trial trade-offs: the storage bucket is public (file names are random UUIDs)
  and anyone with the anon key could upload a file into it. Tighten both before
  going beyond the trial.

## 2. Environment variables

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the **anon public** key |

Local dev:

```bash
cd flow-clock
cp .env.example .env    # fill in the two values
npm install
npm run dev             # http://localhost:5173
```

Voice notes and the camera need HTTPS on a phone — use the Netlify deploy (or
`npm run dev -- --host` plus a tunnel) to test on a real phone.

## 3. Deploy to Netlify

1. Netlify → **Add new site → Import an existing project** → pick this GitHub
   repo.
2. Build settings — set **Base directory** to `flow-clock`. The build command
   (`npm run build`) and publish directory (`dist`) come from
   `flow-clock/netlify.toml`. Make this a **new** Netlify site so it doesn't
   affect the existing stock scanner.
3. **Site configuration → Environment variables**: add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. Then **Deploys → Trigger deploy** (Vite bakes them
   in at build time, so re-deploy after changing them).
4. Optional: **Domain management** → set a short name, e.g.
   `flowclock.netlify.app` or `clock.flowautobody.com.au`. **Decide this before
   writing the tags** — the URL is written onto every card.

SPA routing is handled by `public/_redirects` (`/* /index.html 200`), so
`/t/66` and `/clock` load the app directly when a tag is tapped.

## 4. Write the NFC tags (free "NFC Tools" app)

Use NTAG213/215/216 cards/tags. Install **NFC Tools** (wakdev) on Android or
iPhone (iPhone XS or newer can write).

**Key cards 1–100** — for each card:

1. Open NFC Tools → **Write** → **Add a record** → **URL / URI**.
2. Enter `https://<your-site>/t/1` (card 1), `/t/2` for card 2, and so on.
   Make sure `https://` is selected. → **OK**.
3. Tap **Write** and hold the card on the back of the phone until it says
   *Write complete*.
4. Test: lock/unlock the phone and tap the card — it should open Flow Clock
   on that card number.
5. Optional: **Other → Lock tag** stops anyone rewriting it (permanent — only
   do it once you're happy with the URL).

Tip: NFC Tools can keep the record list between writes — edit just the number
and write the next card.

**Office tag** — same steps with the URL `https://<your-site>/clock`. Stick it
by the office door.

**QR backup** — log in as admin, open `/cards`, check the site URL at the top
matches what's on the tags, **Print** (A4, 100% scale), cut out and stick each
QR on the matching card. iPhones without NFC background reading, or a dead tag,
can scan the QR with the camera instead.

## 5. Day-to-day

- **Car arrives:** reception → **+ New job**, then type (or tap/scan) a free
  card number and pick the job. Hang the card on the key.
- **Tech starts work:** tap the card → **Clock On** → pick the task. If they're
  on another job the app asks, then clocks them off it automatically. If they
  forgot to clock in for the day, they're clocked in too.
- **Supplement:** tap the card → **Add Supplement** → Photo / Video / Voice /
  Note (optional note with each) → **Send to office**. With no signal it's
  saved on the phone and sent automatically when the phone is back online
  (banner at the top shows anything waiting, with a **Retry now** button).
- **Delivered:** reception → **Release** on the card → job marked Delivered,
  anyone still on it is clocked off, the card is free to reuse.
- **Board:** leave `/board` open on the office screen; it updates live.

Admins tapping an **unassigned** card on their phone get an "Assign this card"
button — handy for iPhones, where the browser can't read NFC directly (Android
Chrome gets a **Tap card (NFC)** button in reception).

All times are shown in **Australia/Brisbane**.

## Out of scope for the trial (hooks left in place)

- **iBodyshop integration** — jobs are keyed in manually. `jobs.ibodyshop_ref`
  is stored for a future sync (e.g. a scheduled Edge Function that upserts jobs
  on that ref).
- **AI processing of supplements** — transcribe voice notes, pull a parts list
  from photos/video and push it to the job. Suggested approach: add
  `transcript`, `ai_parts jsonb`, `ai_processed_at` columns to `supplements`,
  and a Supabase **Database Webhook on INSERT** → Edge Function. Media is in
  the `supplements` bucket under `job-<id>/<uuid>.<ext>` (`file_path` column).
- **Native app** — this is a web app; it can be added to the home screen.

## Project layout

```
flow-clock/
  supabase/migrations/…_flow_clock.sql   schema, security, functions, bucket
  supabase/seed.sql                      cards, dummy techs & jobs
  public/_redirects                      Netlify SPA routing
  netlify.toml
  src/lib/        supabase client, API/error handling, outbox (offline queue),
                  media helpers, Brisbane time formatting, session (PIN login)
  src/components/ layout, login + PIN pad, supplement capture, voice recorder
  src/pages/      Home, Clock, Tag (/t/:card), Reception, Board, Cards
```
