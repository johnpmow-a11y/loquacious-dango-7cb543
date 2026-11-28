ALL ADS MANAGER — FLY.IO DEPLOYMENT

This project uses the existing public/ application and the existing Netlify Functions handlers. The Fly runtime adapter in server.mjs serves public files and routes /.netlify/functions/<function-name> to the matching handler in netlify/functions/. Existing function names and browser API paths are preserved.

BEFORE DEPLOYING
1. Install the Fly CLI and sign in: fly auth login
2. Open fly.toml and replace the placeholder app name with a unique Fly.io app name.
3. Create the Fly app using that same name: fly apps create YOUR_UNIQUE_APP_NAME
4. Copy ALL environment variable names and values from the existing production Netlify site into Fly secrets. Do not paste secrets into this ZIP, GitHub files, or public browser code.
5. Deploy from the extracted project root: fly deploy
6. Check the machine and health endpoint: fly status and https://YOUR_APP_NAME.fly.dev/_healthz

IMPORTANT SERVER SECRETS
Transfer the existing values configured for the current application, including the applicable Supabase server credentials, live Paystack key, NexOTP, Turnix, Gmail, push/VAPID, Composio, Rediprofiles, Meta webhook, X Ads and any other service keys currently in use. Preserve the exact existing variable names and values. In particular, keep SUPABASE_SERVICE_ROLE_KEY, PAYSTACK_SECRET_KEY, NEXOTP_API_KEY, TURNIX_API_TOKEN, GMAIL_APP_PASSWORD, COMPOSIO_API_KEY, REDIPROFILES_API_KEY, META_WEBHOOK_VERIFY_TOKEN, META_APP_SECRET, X_ADS_CONSUMER_SECRET and X_ADS_TOKEN_ENCRYPTION_KEY server-side as Fly secrets. Never expose them in public/ files.

The social-account supplier key remains REDIPROFILES_API_KEY. COMPOSIO_API_KEY is for supported advertising and connected-account integrations; it is not the Rediprofiles supplier key.

DATABASE AND EXISTING CUSTOMER DATA
The Fly adapter does not create, reset, or migrate the Supabase database. Keep the existing Supabase project and customer data. Do not reset the database. Apply only migrations that are confirmed pending in the existing project, in their documented dependency order.

WEBHOOKS AND CALLBACKS
After Fly is live, update provider webhook/callback URLs that currently point to the old host so they point to the new Fly domain. This includes Meta/WhatsApp webhook and X Ads OAuth callback URLs where those integrations are enabled. Keep the same verification tokens and encryption keys.

CALLING
The browser call transport in this source is native WebRTC with Supabase signalling and Turnix TURN credentials. The Fly adapter does not add the LiveKit SDK or LiveKit credentials.

HEALTH AND LIMITS
The Fly health endpoint is /_healthz. The HTTP adapter accepts request bodies up to 12 MB; media uploads should continue using the existing signed Supabase Storage upload flow. Keep one machine running for reliable webhook and incoming-call signalling availability. Fly machine, bandwidth and storage usage may incur charges under Fly.io's current pricing.

This package is source-level verified, not a live Fly deployment. After deployment, test login, wallet balance, Paystack live payment and webhook, NexOTP catalogue/order/refund, Rediprofiles account order, Composio connections, WhatsApp inbound/reply/media, push notifications, WebRTC on two phones, camera/microphone permissions, and the Home feed on iPhone and Android.
