# BUORGE PARIS — merchant guide

This is a private, database-backed test store. It is not yet ready for unrestricted public sales. No real payment should be sent in test mode.

## First administrator

1. Open `/admin/login` on the deployed Site and sign in with your merchant ChatGPT account.
2. Open the private local file `.sites-runtime/private/admin-setup.txt` and enter its one-time setup key.
3. This assigns administrator access to that account. Subsequent visits use secure sign-in; the setup key cannot be reused.

The setup file, encryption key, local database and test customer records are excluded from the source repository and deployment archive. Local preview sign-in uses a development-only identity; it is not included in production.

## Product management

Open **Products → Add product**. Enter English and French content, a unique URL slug, selling price, actual MRP and stock. Upload at least five photos, choose the cover image, then select Published and save. Uploaded files persist in cloud object storage. Archive hides a product without destroying order history. Duplicate creates an editable draft.

The ten starter products and AI-generated photographs are clearly identified samples. Replace the descriptions, notes, prices, photographs and packaging details with your actual goods. Turn off the sample flag only after verifying those details. Live checkout refuses sample products.

Each product currently has one sellable size. Independent per-size variants and variant inventory still require implementation; for now, create a separate product for each size.

## Payments and orders

Manual UPI starts in **test** mode. Test checkout records a pending order and reserves stock; it does not charge money or verify a bank transaction. A customer-supplied UPI reference never marks an order paid.

For live mode, configure your genuine UPI ID and receiver, optionally upload a QR image through the product image uploader and copy its returned media path into payment settings, configure Shiprocket serviceability, review your policies, and replace all sample products. Shipping remains ₹0 at checkout.

In Orders, inspect the reference against your actual merchant account before confirming payment. Cancel an unpaid order to restore its reserved stock. Paid returns require manual review and an external refund; there is no automatic refund or payment-gateway capture integration.

Duplicate checkout submissions use a cart revision key and cannot create two orders for the same cart revision. Server-calculated prices, discounts and inventory determine the order; client-supplied totals are ignored.

## Providers

Credentials are entered in **Integrations** and encrypted using AES-GCM before database storage. Secret values are never returned to the browser. Blank credential fields preserve existing values.

### Supabase phone and email OTP

Enter your Supabase project URL and publishable/anon API key, then enable the authentication connection. In Supabase, enable email and phone authentication, configure a real SMS provider and production email sender, and configure the email template to include the OTP code rather than only a magic link. The customer flow is `/en/account/login` or `/fr/account/login`.

The server calls Supabase to send and verify codes. Sessions are encrypted and stored in HttpOnly, SameSite cookies; refresh tokens stay server-side. No development or fake OTP is accepted. ChatGPT sign-in is also available. Linking an already verified phone and email onto one existing customer profile remains to be implemented and tested.

Official setup: [Phone authentication](https://supabase.com/docs/guides/auth/phone-login), [email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless).

### Shiprocket

Create a dedicated Shiprocket API user. Save its credentials, the registered pickup location name, pickup PIN code, package weight and dimensions, then enable shipping. Live checkout verifies delivery serviceability before accepting the order.

For a paid live order: create the shipment, find available couriers, select a courier, assign its AWB, generate the label and sync tracking. Test orders cannot create real shipments. If a request has an ambiguous result, shipment creation is locked for reconciliation in Shiprocket rather than blindly retried. Shipping label and courier charges are borne by the merchant.

Official setup: [Shiprocket API](https://apidocs.shiprocket.in/).

### Email and WhatsApp

For email, verify your domain in Resend, enter the API key and sender, enable the provider, and send an administrator test email. Transactional order notifications can be enabled separately from marketing. Test orders do not send transactional messages.

For WhatsApp automation, save the Meta token and phone number ID, select an API version supported by your account, and configure an approved template with one text body parameter. The template's language must match the configured code. WhatsApp requires the applicable recorded opt-in.

The support chat button is independent: enter a real international number, then enable it. No placeholder number is linked.

Official setup: [Resend email API](https://resend.com/docs/api-reference/emails/send-email), [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/).

## Offers, popups and messaging

Discounts can be percentage or fixed INR amounts, with product/category scope and start/end dates. The best eligible offer applies without stacking. Disable an offer to restore ordinary prices.

Popups use editable EN/FR content, a linked offer, eligible page names, delay and frequency. Checkout is excluded. Exit-intent detection is not implemented.

Email and WhatsApp campaigns support customer segments, bilingual content and a scheduled start. **Process due messages** evaluates currently opted-in customers and submits due messages through configured providers. Recovery settings support editable reminder hours and email/WhatsApp channels. Only identified, contactable, opted-in customers are eligible. Recovery URLs expire after 72 hours and do not expose customer addresses. Completed carts and withdrawn consent stop future recovery attempts.

Unattended processing is **not active** until you connect a scheduler. Configure a secret `AUTOMATION_TOKEN` in Sites and have your scheduler POST to `/api/automation/run` using `Authorization: Bearer <token>`. While the Site is owner-private, the scheduler also needs authorized Sites service access; do not weaken sharing to bypass that restriction. Credentials must remain in the scheduler's secret store. Process at most 30 new messages per invocation.

Message history distinguishes provider acceptance and failure. Delivery/open/click webhooks and WhatsApp inbound opt-out handling are not implemented. Do not treat an accepted message as delivered. Campaign revisions have separate deduplication identities; editing and re-enabling an already sent campaign can send the new revision again.

## Analytics and customer data

The dashboard shows actual database events and actual orders only. Test payments are excluded from live revenue. Optional visit tracking requires consent. Essential cart/order events are separate from optional browsing events, so the displayed funnel is not a cohort conversion rate.

Location summaries use customer-entered live-order shipping addresses. They are not independently verified. IP geolocation, geographic maps, date-range filters, attribution and advanced cohort reports are not implemented.

Customers can edit their profile, withdraw marketing consent and request data export or deletion. Requests are logged for merchant handling; automatic deletion and verified identity linking remain pending. The merchant export contains personal data and must be stored securely.

## Backups and recovery

Use Activity & data → Download export before substantial catalogue changes. The export includes products, non-secret settings, orders, customers, campaigns and the audit history. It is not a full infrastructure backup: retain the encryption key separately, preserve R2 image storage, and establish provider-level D1/R2 backups before production. A tested automated restore workflow is still required.

## Validation and remaining launch work

Local tests cover product publication with five uploaded images, persistence across requests, discount on/off, backend cart pricing, quantity validation, concurrent duplicate checkout, stock reservation/restoration, pending UPI verification, unauthorized admin access, cross-customer order access, CSRF rejection, popup persistence and real analytics recording. Desktop and mobile browser checks include French product content and a complete French test checkout.

External OTP delivery, bank verification, real shipping, emails and WhatsApp have not been tested because merchant credentials are not configured. Public launch also requires final merchant policies, tax/invoice handling, real product data, production security review, backups and an end-to-end test using your provider accounts.

Known implementation gaps beyond those above: multiple stock-controlled variants, saved-address editing and verified contact linking, review submission/moderation, arbitrary page/translation editing, shipment/message webhooks, back-in-stock automation, detailed attribution, and automated privacy-request fulfilment. This delivery is a working core commerce build with provider adapters, not a claim that every item in the master brief is complete.
