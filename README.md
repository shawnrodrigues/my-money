# My Money

A privacy-first personal finance tracker for recording spending, lending, repayments, people, goals, reminders, and printable payment statements.

## Features

- Supabase Auth with member and administrator roles
- Personal entries for spending, lending, and repayments
- People directory with per-person balances
- Full payment statements with remarks
- Browser print flow for saving statements as PDF
- WhatsApp-ready text sharing
- Goals and optional Discord repayment reminders
- Responsive desktop and mobile layouts

## Requirements

- Node.js 20 or newer
- A Supabase project
- A configured Supabase Auth email provider

## Local setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create a local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. In `.env`, set the public Supabase URL and publishable/anon key from Supabase Project Settings > API:

   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-public-key
   ```

   Never put a service-role key in `.env` or any `VITE_` variable.

4. In Supabase Dashboard > SQL Editor, run the complete [supabase/setup.sql](supabase/setup.sql) file. It creates the tables, indexes supplied by PostgreSQL constraints, RLS policies, user-profile trigger, and schema-cache refresh.

5. After creating your account, promote the first administrator in SQL Editor:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'your-email@example.com';
   ```

6. Start the app:

   ```powershell
   npm run dev
   ```

## Administrator function

The admin area is visible only when the signed-in user's `profiles.role` is `admin`. Invite users, change roles, edit display names, request password-reset emails, and remove accounts through the protected Edge Function.

Deploy it after authenticating the Supabase CLI:

```powershell
npx supabase login
npx supabase functions deploy admin-users
npx supabase secrets set SITE_URL=https://your-deployed-site.example.com
```

For local development, use `SITE_URL=http://localhost:5173` as the function secret. The function requires `SUPABASE_SERVICE_ROLE_KEY` through Supabase's managed function environment and it must never be exposed in browser code.

## PDF and WhatsApp

Open **People**, select a person, then choose **Save as PDF**. In the browser print dialog select **Save to PDF**. **Share on WhatsApp** opens a preformatted message containing totals, balance, dates, descriptions, and remarks. PDF files must be attached manually in WhatsApp.

## Validation

```powershell
npm run build
```

## Security checklist

- Keep `.env` private; only commit `.env.example`.
- Use the publishable/anon key in the browser, never the service-role key.
- Run `supabase/setup.sql` before using the application.
- Enable email confirmation and configure the production redirect URL in Supabase Auth.
- Deploy the admin function and set `SITE_URL` to the exact production origin.
- Review [SECURITY.md](SECURITY.md) before publishing.

## License

No license has been selected yet. Add a license before accepting external contributions.
