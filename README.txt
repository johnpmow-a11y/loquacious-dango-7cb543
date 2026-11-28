ALL ADS MANAGER — PROJECT NOTES

This file is a short project overview. For Fly.io deployment, use FLY_DEPLOYMENT_README.txt. For the existing Netlify deployment, use DEPLOYMENT_README.txt. Keep the current Supabase project and customer data whichever hosting target is used.

BRAND AND CUSTOMER ACCOUNTS
- Product name: All Ads Manager. Customer-facing service labels use ADS, not “demo”.
- Customer login remains username/name plus a four-digit code. Email is not the login credential; a registered email address is used for customer-controlled code recovery and account communications.
- The existing Supabase customer/admin session model is retained. Do not replace it with Supabase Auth or change the working login flow.
- Existing customer history, administrator messages, support inbox, gift delivery, consignment jobs, ready-made account orders, and service modules are retained.
- The legacy browser storage key businessTools_demo_v1 is intentionally retained internally to protect existing browser-side data. It is not a customer-facing brand.

WALLET AND PAYMENTS
- Add Funds accepts NGN 100 through NGN 3,000,000.
- Service-payment checkout now calls the server-side Paystack initializer immediately; network requests have bounded timeouts.
- Card details are entered only on Paystack. Do not collect or store card numbers, CVV, PIN, OTP, or 2FA codes in this application.
- Paystack webhook and wallet-credit logic remain server-side. Keep the existing live Paystack and Netlify settings.
- Customer wallet withdrawals are disabled. Do not apply the historical 20261113_wallet_withdrawals.sql migration.
- Do not describe live settlement as verified unless it has been tested against the live Paystack dashboard and deployed Netlify site.

CUSTOMER SECURITY
- Username-only code reset is disabled because a username alone does not prove account ownership.
- Customers recover their four-digit code through the registered email address using a time-limited six-digit code, as described in DEPLOYMENT_README.txt.
- The administrator cannot reset customer codes through an admin reset control or RPC. Do not restore username-only code changes.

NEXOTP AND OTHER SERVICES
- NexOTP is the only verification-number provider. Its API key stays server-side in Netlify as NEXOTP_API_KEY.
- NexOTP catalogues and orders are handled by Netlify functions; the key is never exposed in the browser.
- Customer prices show only the final NGN price. Country markups are USA +₦1,900, Canada +₦1,500, UK +₦1,950 and all other countries +₦1,950.
- NexOTP supports short-term US numbers, 30-day US numbers and other-country short-term services as returned by its live catalogue.
- Customer-facing prices show only the final amount; the markup is never displayed separately.

CALLING AND CHAT
- Audio/video calls use native WebRTC with Supabase signalling; Turnix TURN relay credentials are configured with TURNIX_API_TOKEN. LiveKit SDK credentials are not required.
- The private chat includes full-screen mobile layout, typing indicators, read receipts, voice notes, media attachments, long-press message actions and persistent reactions. Apply the additional chat migrations listed in DEPLOYMENT_README.txt before relying on the corresponding database-backed features.

EMAIL
- Existing email-sending code and configuration are preserved; this provider update does not modify the mail transport.
- Only visible sender name, subject and message branding may be updated. Do not replace the working email configuration.

READY-MADE ACCOUNTS
- The ready-made account catalogue and order flow use the configured supplier integration.
- Actual profile photos and account metadata can only be displayed when supplied by the provider. Do not claim an item is in stock unless the current supplier catalogue confirms it.

DEPLOYMENT AND VERIFICATION
- Deploy the complete project root, including public/, netlify/functions/, package.json, netlify.toml, and supabase/ files. Do not upload only public/ because server functions are required.
- Keep existing Netlify environment variables and secrets. Never put service-role keys, Paystack secret keys, Gmail app passwords, or supplier API keys in browser code.
- Repository source changes do not automatically apply SQL to Supabase or deploy to Netlify. Apply only migrations identified as required in DEPLOYMENT_README.txt, and only if not already applied.
- GitHub Actions checks JavaScript syntax and packages the project. A successful source build does not prove the live Netlify, Supabase, Paystack, Gmail, push-notification or supplier systems work; those require deployment and live checks.
