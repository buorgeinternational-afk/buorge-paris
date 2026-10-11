# BUORGE PARIS

Private bilingual fragrance commerce application.

See [Merchant guide](docs/merchant-guide.md) for administrator setup, provider connections, tested behavior and remaining launch work.

Architecture: React/Vinext on Cloudflare Workers; D1 database; R2 image storage; Sites-managed administrator identity; optional Supabase phone/email OTP; server-side Resend, Meta and Shiprocket adapters.

Run `npm run dev` for local preview. Run `npm run build` for a production build. Generate schema changes with `npm run db:generate`. Apply the generated migrations before running the app locally. Sites applies hosted migrations during publication.

`node scripts/test-commerce.mjs` runs the local integration suite on port 5197 using synthetic test data and development-only sign-in. It never sends live payments or creates live shipments.

Never commit `.dev.vars`, `.sites-runtime`, credentials, or local database state.
