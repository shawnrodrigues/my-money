# Security Policy

## Secrets

Never commit `.env`, Supabase service-role keys, access tokens, webhook URLs, or user data. The browser may use only the Supabase publishable/anon key. Service-role credentials belong only in Supabase Edge Function secrets.

If a secret is exposed, rotate it immediately in the provider dashboard. Removing it from Git history is not enough.

## Supabase requirements

Run `supabase/setup.sql` in the Supabase SQL Editor. Keep Row Level Security enabled on every application table. The policies are designed so members access their own records; administrator actions run through the server-side `admin-users` function.

Enable email confirmation and configure exact production redirect URLs under Supabase Authentication settings. Set the Edge Function `SITE_URL` secret to the exact deployed origin.

## Reporting a vulnerability

Do not open a public issue containing credentials, private user data, or an exploitable proof of concept. Contact the repository owner privately with reproduction steps and the affected component.
