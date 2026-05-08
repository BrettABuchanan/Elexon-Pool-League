# ELEXON Pool League

A small static dashboard for tracking monthly wins. Backed by Supabase so the league syncs across every device you sign in on.

## How it works

* One shared league lives in a single row of a Supabase table (`league_state`).
* Anyone who signs in with email gets a magic link, and once signed in can view and edit the standings.
* Sign out, or sign in on a phone, and you'll see exactly the same scores.

## 1. Create the database

1. Go to your Supabase project → **SQL Editor**.
2. Paste the contents of `supabase-schema.sql` and **Run**.
   * Safe to re-run — it drops any older anonymous policies and replaces them with signed-in-only policies.

## 2. Turn on email magic links

1. In Supabase → **Authentication** → **Providers**, make sure **Email** is enabled.
2. Under **Authentication → URL Configuration**, add the URLs you'll open the app from to the **Redirect URLs** allowlist. Typical entries:
   * `http://localhost:8000` (or whatever local port you use)
   * Your production URL (e.g. `https://your-site.netlify.app` or your GitHub Pages URL)
3. Set **Site URL** to your production URL.

> Magic links won't work when opening `index.html` directly via `file://` — the auth redirect needs an `http(s)://` origin. Run a tiny local server (e.g. `python3 -m http.server`) or deploy to Netlify / GitHub Pages.

## 3. Plug your Supabase keys into the app

1. In Supabase → **Project Settings → API**, copy:
   * **Project URL**
   * **anon public** key
2. Paste them into `config.js`:
   ```js
   window.POOL_LEAGUE_CONFIG = {
     supabaseUrl: "https://YOUR-PROJECT.supabase.co",
     supabaseAnonKey: "eyJhbGciOi…"
   };
   ```

The anon key is safe to commit — it's a public key. Row-level security (set up in step 1) is what actually protects your data.

## 4. Deploy

Either:

* **Netlify** — drag this folder onto Netlify, or connect your GitHub repo. `netlify.toml` is already configured.
* **GitHub Pages** — in the repo settings, enable Pages from the `main` branch.

## 5. Sign in

1. Open your deployed URL.
2. Enter your email, click **Send sign-in link**.
3. Click the link in the email — you're in.
4. Open the same URL on your phone or another laptop, sign in with the same email, and you'll see the same standings.

## Inviting other players

Magic-link auth works for any email — just give players the URL and they can sign themselves in. Everyone signed in shares the same league, so anyone can add wins or correct scores. If you need to lock that down later, the schema is easy to change to admin-only writes.

## How concurrent edits are handled

Two devices can edit at the same time without trampling each other.

* Every cell — each (player, month) — keeps its own timestamp.
* Before saving, the app fetches the latest remote state and merges it cell-by-cell with yours. The fresher timestamp wins per cell, so edits to **different** players or months are all preserved.
* Realtime is enabled on the `league_state` table, so when one device saves, others receive the change live and merge it into the view immediately. No manual refresh needed.
* If two devices edit the **same** (player, month) cell at the same instant, the later timestamp wins. Practically rare in a small team league, but worth knowing.
* New players added on either device merge in from both sides (union by player id).

## Troubleshooting

* **"Supabase is not configured yet"** — fill in `config.js` and reload.
* **No email arrives** — check spam, and make sure your redirect URL is in Supabase's allowlist.
* **"Could not send sign-in link"** — usually means the redirect URL isn't allowlisted.
* **Standings reset to defaults after sign-in** — that means the remote read failed; check the browser console for an RLS error and re-run `supabase-schema.sql`.
