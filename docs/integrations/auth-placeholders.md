# Auth Integration Placeholders

## Current status

- Email/password registration, login, logout, and password reset are wired to MySQL.
- Google OAuth has a complete route skeleton, but no client credentials are configured yet.
- Email verification has a provider boundary in `server/email-service.js`.
- SMTP email delivery is implemented through `nodemailer`.
- Local development can still use `EMAIL_PROVIDER=dev` and `EMAIL_AUTH_DEV_MODE=true` when a real mailbox is not available.

## Google OAuth placeholder

Environment variables:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://127.0.0.1:4173/api/auth/google/callback
```

When credentials are missing, `/api/auth/google/start` returns a formal unavailable page and does not create users.

When credentials are provided later, the expected Google Console redirect URI is:

```text
https://your-domain.example/api/auth/google/callback
```

## Email provider

Gmail SMTP environment variables:

```env
EMAIL_AUTH_DEV_MODE=false
EMAIL_PROVIDER=smtp
EMAIL_FROM="Alove <support@example.com>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_SECURE=false
SMTP_PROXY=
```

Supported provider values:

- `smtp`: sends real verification emails through SMTP. Use a Gmail App Password for `SMTP_PASSWORD`.
  - `SMTP_PROXY` is optional. Leave it empty on servers that can reach Gmail SMTP directly; use it only for local networks that require a proxy for SMTP connections.
- `dev`: local-only development mode. Does not send email and can expose `devCode` when `EMAIL_AUTH_DEV_MODE=true` and the public host is local.
- empty / `unconfigured`: production-safe placeholder. The API returns a configuration error instead of pretending to send email.

## Responsibility split

`server/email-service.js` owns delivery provider logic and email content. `server/auth-service.js` owns auth rules, rate limits, code hashing, and database writes.
