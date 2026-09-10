# Virello Store — Cross-Device Version

This version keeps the original `Virello_Store MAIN.html` display, layout, Admin Login and discreet six-tap access. The important change is the data layer: orders, products, reviews, homepage/contact/rules settings and order tracking are stored centrally on the server instead of browser localStorage.

## Run locally
1. Install Node.js 18+ (20+ recommended).
2. Open a terminal in this folder.
3. Run `npm install`.
4. Set an admin password before starting. Example:
   - Windows PowerShell: `$env:ADMIN_PASSWORD="your-strong-password"; $env:SESSION_SECRET="a-long-random-secret"; npm start`
   - macOS/Linux: `ADMIN_PASSWORD="your-strong-password" SESSION_SECRET="a-long-random-secret" npm start`
5. Open `http://localhost:3000`.

Default username is `admin`. If no `ADMIN_PASSWORD` is supplied, the server uses `CHANGE-ME-NOW`; change it before any real deployment.

## What now works across devices
- A customer placing an order creates a central database record.
- The admin can log in from another phone/computer and see the order.
- The customer can enter the reference number from any device and see the current status.
- Admin status changes are reflected when the reference is checked again.

## Production note
For a real public deployment, use HTTPS and a persistent database/host. The included SQLite database is suitable for local testing and a single persistent server; do not rely on an ephemeral hosting filesystem for a live shop. Set a strong `ADMIN_PASSWORD` and `SESSION_SECRET`.
