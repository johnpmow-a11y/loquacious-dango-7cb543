ALL ADS MANAGER — COMPLETE NETLIFY PROJECT

Deploy the complete repository/project root, not only the public folder:
- public/ (customer website and public tracking/payment return pages)
- netlify/functions/ (server-side integrations)
- supabase/migrations/ (database migration history)
- package.json
- netlify.toml
- README.txt and this file

EXISTING CONFIGURATION — PRESERVE IT
Keep the existing Supabase project, customer/admin login model, Netlify site and working Gmail delivery settings. Do not replace working secrets or payment settings as part of this update.

The current integrations use the existing environment variables, including:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- PAYSTACK_SECRET_KEY (use the approved LIVE secret for real payments)
- NEXOTP_API_KEY
- SHADOW_OTP_API_KEY
- SHADOW_OTP_PKR_NGN_RATE
Preserve any additional variables already configured for other services. Never put service-role keys, payment secrets, Gmail app passwords or supplier API keys in public browser code.

REQUIRED DATABASE MIGRATIONS FOR THIS UPDATE
Apply the following in the existing Supabase project ftwhcqrtmfxdzokmudvu, only if not already applied:
0. supabase/migrations/20261113_secure_customer_code_recovery.sql
   Removes the unsafe username-only password-reset function.
1. supabase/migrations/20261115_customer_only_email_password_recovery.sql
   Creates/repairs registered customer email storage and secure six-digit email reset codes; expires codes after 10 minutes; limits attempts; resets the customer's four-digit code; and DROPS the administrator customer-code reset function.
2. supabase/migrations/20261115_disable_wallet_withdrawals.sql
   Revokes wallet withdrawal functions.
3. supabase/migrations/20261115_delivery_custom_gift_message.sql
   Adds the optional personalized gift message.
4. supabase/migrations/20261115_private_customer_media_messages.sql
   Creates private customer-specific image/video message records.

The consolidated customer-only recovery migration replaces the older separate customer-contact-email and secure-email-recovery migrations for this deployment. Do not run both sets unnecessarily. Do not rerun historical migrations or reset the database.

Do NOT apply supabase/migrations/20261113_wallet_withdrawals.sql. If it was applied previously, migration 2 above disables its withdrawal functions. Do not rerun historical migrations or reset the database.

SOCIAL APPLICATION DATABASE MIGRATIONS
The social feed, 18+ confirmation, profiles, follows, coins, paid-video unlocks, chats, notifications and admin social dashboard also require the following migrations, applied in this exact timestamp order after the customer/account foundation above. Apply each only if it has not already been applied; do not skip an earlier dependency:
1. supabase/migrations/20261118090000_social_feed_coins_foundation.sql
2. supabase/migrations/20261118090100_social_customer_init.sql
3. supabase/migrations/20261118090200_social_rewards_and_video_unlocks.sql
4. supabase/migrations/20261118090300_social_interactions_chat_rpc.sql
5. supabase/migrations/20261118090400_social_notification_preferences.sql
6. supabase/migrations/20261118090500_social_notification_preferences_and_profile_views.sql
7. supabase/migrations/20261118100000_community_group_chat.sql
8. supabase/migrations/20261118100100_direct_chat_group_separation.sql
9. supabase/migrations/20261118110000_professional_video_only_coin_unlocks.sql
10. supabase/migrations/20261118120000_remove_age_gate_and_promotion_coins.sql
11. supabase/migrations/20261118130000_admin_selective_video_locking.sql
12. supabase/migrations/20261118150000_one_time_video_earnings_ledger.sql
13. supabase/migrations/20261119130000_separate_social_coin_balances_and_earnings.sql
14. supabase/migrations/20261119160000_manager_promotion_campaigns.sql
The 20261119130000 migration restores the explicit 18+ confirmation timestamp/RPC, separates free and purchased viewing coins, and creates the current one-time paid-video unlock and earnings accounting. The final 20261119160000 migration creates Manager Promotion campaign records and Money-Coin-only campaign payment. It must run after the preceding social migrations. Promotion submissions remain under review; no external advertising provider is automatically called, and payment is unavailable until the administrator sets a campaign price after provider pricing/approval is confirmed. The earlier age-gate-removal migration is retained in the ordered history; the final migration restores the current 18+ confirmation mechanism. Do not apply only the final migration to a database missing the earlier social foundation.

LIVEKIT AUDIO AND VIDEO CALLING
The calling system uses LiveKit for real-time audio/video rooms and the existing customer/admin sessions for authorization. Apply these migrations in order after the customer/account foundation:
1. supabase/migrations/20261119100000_livekit_call_tables.sql
2. supabase/migrations/20261119190000_admin_livekit_call_identity.sql
3. supabase/migrations/20261119200000_livekit_one_active_call_per_customer.sql
The final migration repairs terminal-call participant rows and enforces one active call per customer at the database level, including concurrent call attempts. Keep LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in Netlify server environment variables only. Do not expose them in browser code. The source checks do not replace real two-device testing of microphone, camera, incoming-call notifications, iPhone audio playback and reconnection.

PASSWORD RECOVERY


WALLET
Customers can add funds and view payment history. There is no customer withdrawal feature. Existing balances and wallet transaction history are preserved.

PAYMENTS
Add Funds remains server-initialized through Paystack and supports NGN 100–3,000,000. Service-payment initialization now starts immediately; network requests have bounded timeouts. Do not claim real-money settlement is verified until the live Netlify deployment, Paystack webhook and actual live transaction have been checked.

DATABASE SETUP
- Apply supabase/migrations/20261122190000_nexotp_wallet_orders.sql before enabling NexOTP number purchases.
- If customer/Admin wallet migration status is uncertain, use supabase/ALL_ADS_MANAGER_WALLETS_SETUP.sql. It includes the existing customer wallet, administrator wallet and NexOTP order migration.
- Run the read-only API & Database Checks from Admin Wallet after deployment. It checks the current Supabase wallet tables/RPC and NexOTP API catalogue without creating a payment or number order.

ADMIN SUPPLIER PURCHASES
The administrator can use the separate Admin Wallet to purchase available NexOTP verification services at supplier cost, with no customer markup. Ready-made social-media accounts can be purchased from the Rediprofiles catalogue at supplier price, also without customer markup. These purchases use administrator funds, not customer wallet balances. Live supplier purchases still require valid API keys, live supplier stock and sufficient Admin Wallet balance.

NexOTP uses its documented NGN prices and live stock. Customer markups are USA +₦1,900, Canada +₦1,500, UK +₦1,950 and all other countries +₦1,950. The order endpoint rechecks price and stock before purchase. The available NexOTP number types are short-term US, 30-day US and other-country short-term services.

EMAIL

SECURITY AND CUSTOMER ACCOUNTS
Customer accounts remain username plus four-digit code. Registered email is used for customer-controlled password recovery by six-digit email code, as well as the existing administrator announcements and customer History notifications. Administrators cannot change customer passwords or four-digit codes. Never enable username-only password changes.

PUSH NOTIFICATIONS
The server-side push flow can notify the administrator about new customer support messages and newly confirmed service payments. Customers can receive notifications for administrator replies, published account notes, service-order status changes, confirmed service payments, successful wallet deposits, delivery status changes, completed editing orders, completed Consignment Box Videos, incoming NexOTP verification codes/status events, and incoming ShadowOTP email verification codes. The notification subscription is tied to the existing customer/admin login session. This is source-level functionality only until deployed and tested with real device subscriptions. For iPhone, install the website using Add to Home Screen on a supported iOS version and grant notification permission; ordinary Safari tabs do not provide the same installed-web-app push experience. System notification sound follows device notification settings.

APP INSTALLATION
The website is configured as an installable Progressive Web App (PWA) using display mode standalone. Customers can add it to their phone home screen on supported browsers. This hides the normal browser address bar when launched as an installed web app, but the phone operating system can still switch apps or minimize it. Google Play Store and Apple App Store distribution are not included in this Netlify website package; they require a separate native/TWA wrapper, store developer accounts, store assets, policy compliance and review.

SERVICE LABELS
Customer menu labels include TikTok Dollar Funding and NextPlace Login. The NextPlace customer email field is the address to receive the login after fulfilment. Facebook Phone requests collect business email, Facebook Page/Ad Account ID, whether 2FA is enabled, total amount and payment method. Never request or store Facebook passwords or 2FA codes.

BUILD AND VERIFICATION
The GitHub Actions workflow .github/workflows/verify-package.yml checks JavaScript syntax for Netlify functions and the inline browser application, then packages the complete repository as All-Ads-Manager-Complete.zip. A successful source build does not prove the live Netlify, Supabase, Paystack, Gmail or supplier systems are working; those require deployment and real environment checks.

PIPEBOARD — MANAGER PROMOTION PROVIDER CONNECTION
The customer-facing Manager Promotion feature accepts advert pictures and descriptions and queues submissions for administrator review. It does not start campaigns or deduct Money Coins until the provider connection is genuinely ready.
Pipeboard documents two different credential paths:
- A standard Pipeboard API token can call the MCP tools for advertising accounts already connected to that Pipeboard account, subject to the token's write permissions and account scope.
- The Partner API key is specifically required to provision a separate Pipeboard user for each All Ads Manager customer and generate that customer's OAuth connection link. The partner flow uses POST /api/v1/partners/users and POST /api/v1/partners/oauth/start.
Do not treat a standard API token as a Partner API key. If All Ads Manager uses one shared advertiser account, the standard token may be sufficient after the account is connected and granted full write access. If each All Ads Manager customer must connect and own a separate advertiser account, Pipeboard Partner API approval/key is required. Until the intended account model and provider connection are verified, campaign pricing/payment remains disabled and promotions cannot go live.

SOCIAL STATUS FEATURE (added 2026-11-21)
- Apply the additive Supabase migration `supabase/migrations/20261121100000_social_status_stories.sql` before deploying the updated app. It creates the 24-hour Status and view-tracking tables and does not change existing customer/admin login or other service tables.
- Deploy the complete project root, including `netlify/functions/social-status.mjs`, `public/social.js`, and `public/social.css`.
- Status media uses the existing private `aam-social-media` bucket and existing server-side customer session model. No new secret is required.
- Status creation, listing, view markers, owner deletion and automatic expiry filtering are implemented. Expired records are excluded from reads; they are not physically purged by a scheduled job.
- Test with two customer accounts: publish text, image and video Status; view a followed customer's Status and confirm its viewed marker; delete an own Status; verify expiry behavior using a test record with an expired timestamp. Confirm that an unfollowed private profile is not exposed.
