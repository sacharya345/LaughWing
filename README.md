# Laugh-Wing

A responsive cloud-kitchen website with an online menu and checkout, a PostgreSQL-backed Express API, and an admin dashboard for orders, menu items, and store settings. The customer website uses vanilla HTML/CSS/JavaScript with Bootstrap components and Tailwind utilities.

## Requirements

- Node.js 20 or later
- PostgreSQL 14 or later
- An SMTP account for email order alerts, and/or a Twilio account for SMS alerts

## Local setup

1. Create a PostgreSQL database named `laughwing`.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, `ADMIN_EMAIL`, and an `ADMIN_PASSWORD` of at least 12 characters.
4. Choose how order alerts are delivered:
   - Email: set `NOTIFICATION_CHANNEL=email`, `ORDER_ALERT_EMAIL`, and the `SMTP_*` settings.
   - SMS: set `NOTIFICATION_CHANNEL=sms`, `ORDER_ALERT_PHONE`, and the `TWILIO_*` settings.
   - Both: set `NOTIFICATION_CHANNEL=both` and configure both providers.
   - `none` is available for local development; online ordering works, but no alert is sent.
5. Install dependencies:

   ```sh
   npm install
   ```

6. Start the website (this builds the stylesheet):

   ```sh
   npm start
   ```

Open `http://localhost:3000` for the ordering site and `http://localhost:3000/admin` for the admin dashboard. The first server startup creates the database tables, loads the starter menu, and creates the admin account if it does not exist. Set `SITE_URL` to the public HTTPS address before deployment so `robots.txt` and the generated sitemap use the right domain.

Set `DATABASE_SSL=true` when the PostgreSQL host requires TLS. If running behind a trusted reverse proxy, set `TRUST_PROXY=true` so secure cookies and rate limiting use the forwarded request information correctly.

## Menu and ordering

The starter menu uses the item prices from the supplied menu reference, formatted in euros; Chicken Sausage is €4.99. The initial delivery fee is €0.00 and can be changed under **Store settings**. Customers can order pickup or delivery, provide either a phone number or email address, and pay when the kitchen confirms the order; online card payments are not configured. Customers can also order directly through WhatsApp at +358 465 833 970 or +358 417 404 315. The kitchen is based in Koskela, Helsinki.

Customers may leave a 1–5 star rating and a public review on the website. Reviews are published immediately, displayed newest first, and limited to five submissions per IP address in a 15-minute window.
Admins can manage the latest 50 reviews in the dashboard: like or unlike them, publish a public owner response, or delete them. Admin review actions require a signed-in session and CSRF validation.

## Admin dashboard

Sign in at `/admin` using the initial `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. The dashboard supports:

- Reviewing recent orders and updating their status
- Receiving persistent in-dashboard order notifications, with unread counts and automatic refresh while signed in
- Liking, responding to, and deleting customer reviews
- Retrying failed email or SMS alerts
- Adding, editing, enabling, disabling, and deleting menu items
- Pausing online ordering and enabling pickup/delivery
- Setting the delivery fee

The initial admin account is seeded only once. To reset its password, remove that account row from `admin_users` and restart the app with the replacement `ADMIN_PASSWORD` in `.env`.

Signed-in admins can create additional admin accounts from **Admin accounts** in the dashboard. Each account can manage the full website, so only create accounts for trusted staff. There is no public admin signup.

Admins can upload one JPEG, PNG, or WebP menu image per item (up to 5 MB); images are stored in PostgreSQL. Consider the database size and backups when adding many large photos.

The **Visitors** dashboard records anonymous page views and timestamps only. It does not collect visitor names, contact details, IP addresses, or tracking cookies. Counts represent page views, not identified or unique people; visitors who do not place orders cannot be identified.

Each successfully placed order is also saved as an admin notification in PostgreSQL. These notifications are available to signed-in admins under **Notifications**, can be marked read individually or all at once, and refresh every 30 seconds. Email alerts are sent separately using the configured SMTP settings; a dashboard notification remains available even if email delivery fails.

## Tests

```sh
npm test
```

The health endpoint at `/api/health` checks the database connection.
