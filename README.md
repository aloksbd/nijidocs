# NijiDocs (निजी) — family document vault

Upload photos or PDFs of important documents, find them instantly by any text inside them,
share with family or colleagues, and send a 15-minute print link to a print shop.
Everything is encrypted in your browser before it's uploaded.

Stack: Next.js 15 on Vercel (free Hobby plan) + Supabase (free plan). OCR runs on-device
(Tesseract, English + Nepali). Sign-in codes are sent by email through Brevo's free plan,
so the whole stack runs on free tiers.

---

## Deploy in about 30 minutes

### 1. Supabase (database, file storage, login)
1. Create a free project at supabase.com. Pick the Singapore or Mumbai region (closest to Nepal).
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. **Authentication → Sign In / Providers → Email**: keep it on, with **Confirm email** on.
   Leave **Phone** off.
4. **Authentication → Multi-Factor**: make sure **TOTP (authenticator app)** is enabled.
5. **Project Settings → API**: copy the Project URL, the `anon` key and the `service_role` key.

### 2. Brevo (sends the sign-in emails, free)
Supabase's built-in email only sends a few messages an hour and is meant for testing, so
connect Brevo's free plan instead (around 300 emails a day at the time of writing).
1. Sign up at brevo.com. Under **Senders, Domains & Dedicated IPs**, add and verify the address
   the emails will come from.
   - Best: an address on your own domain (e.g. `no-reply@nijidocs.com.np`), with the domain
     verified in Brevo (it gives you DNS records to add). Emails are far less likely to land in spam.
   - Works for testing: a personal Gmail address, but expect some codes to land in spam.
2. **SMTP & API → SMTP**: create an SMTP key. Note the login and the key.
3. In Supabase, **Authentication → Emails → SMTP Settings**, turn on custom SMTP:
   - Host `smtp-relay.brevo.com`, port `587`
   - Username: your Brevo SMTP login. Password: the SMTP key.
   - Sender email: the address you verified. Sender name: `NijiDocs`.
4. **Authentication → Emails → Templates**: the app signs in with a code, not a link, so edit
   both **Confirm signup** and **Magic Link** to show the code. For example:
   - Subject: `Your NijiDocs sign-in code`
   - Body: `<p>Your code is <b>{{ .Token }}</b></p><p>It expires in 1 hour. If you didn't try to sign in, ignore this email.</p>`
5. **Authentication → Rate Limits**: raise *emails sent per hour* to something like 30.
6. **Authentication → Providers → Email**: consider lowering *Email OTP expiration* to
   600 seconds (10 minutes).

### 3. Vercel (hosting)
1. Push this folder to a GitHub repository.
2. At vercel.com → **Add New → Project**, import the repository.
3. Add environment variables (see `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; never prefix with `NEXT_PUBLIC_`)
4. Deploy. Then in Supabase **Authentication → URL Configuration**, set the Site URL to your
   Vercel address.

Run locally: `cp .env.example .env.local`, fill it in, `npm install`, `npm run dev`.

### Free-plan limits to know
- Supabase free projects **pause after 7 days with no activity**; un-pause from the dashboard.
- 1 GB file storage and 500 MB database on Supabase free. Each file can be up to 25 MB.
- Vercel Hobby is for personal, non-commercial use. Move to Pro if you charge for this.

---

## How it works

**Signing in:** a code sent to your email, then a code from an authenticator app (required).
Every database rule checks that both steps were completed.

**Mobile numbers:** when setting up the vault, each person enters their mobile number. Family
members use it to add each other to groups. Only one account can hold a number, but the number
isn't verified by SMS, so someone could register another person's number first. That's fine
among people who know each other; switch to SMS verification before opening this to strangers.

**The vault:** at first sign-in each person chooses a *vault passphrase* and gets a
*recovery key* to write down. These never leave the device. Forget both and the documents
cannot be recovered — by anyone. The vault locks itself after 15 minutes idle.

**Encryption:**
- Each document gets its own random AES-256 key. Files and details (name, ID, owner, number,
  expiry, OCR text) are encrypted with it.
- Each person has an RSA-3072 key pair; the private key is stored encrypted with their
  passphrase (PBKDF2, 600,000 rounds) and separately with their recovery key.
- Each group has its own key, given to every member encrypted with their public key.
  Sharing a document with a group = storing its key encrypted with the group key.
- The permanent ID's uniqueness and the duplicate check use keyed hashes, so the server can
  enforce them without learning the ID or file contents.

**One copy per document:** a document is stored once. Groups and folders only hold references.
Deleting it removes it everywhere.

**Search:** after unlocking, your browser decrypts names, IDs, owners, numbers, folder and group
names, and OCR text, and builds a search index in memory. It supports partial words, small
typos and Nepali text. You can correct the OCR text on any document to improve results.

**Print links:** the link looks like `/p/<id>#k=<document key>`. Browsers never send the part
after `#` to any server — including ours — so the shop's browser decrypts the file itself. The
server only hands out the encrypted file during the 15-minute window. After it expires the shop
can tap **Ask for 15 more minutes** (up to 5 times); you approve it in the app. You can turn a
link off at any time, and every open is logged.

## Known limits of this MVP
- Anyone who can see a document on screen can photograph or save it. The print page hides
  download options, but a browser's "Print to PDF" still works.
- Removing someone from a group blocks their access on the server immediately, but someone who
  copied the group key while they were a member could decrypt data they already downloaded.
  Rotating group keys on removal is a planned improvement.
- Folder names and group names are **not** encrypted. Keep them general.
- On-device OCR is weaker than cloud OCR, especially for handwritten or blurry Nepali. Well-lit,
  flat photos work best.
- Passkeys are not included yet (Supabase doesn't offer passkey sign-in natively).
- Mobile numbers are not verified (see above).

## Already ran the old phone-login schema?
Run this once in the SQL editor instead of re-running the whole file:
```sql
alter table public.profiles add column if not exists email text unique;
alter table public.profiles add constraint profiles_phone_format check (phone ~ '^[0-9]{8,15}$');
update public.profiles p set email = u.email from auth.users u where u.id = p.id;
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into profiles (id, email) values (new.id, new.email); return new; end $$;
grant update (display_name, phone, public_key, vault, vault_recovery) on public.profiles to authenticated;
```
