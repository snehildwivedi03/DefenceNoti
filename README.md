# TrackMyNextAttempt — Indian Defence officer-entry notification tracker

Lightweight personal tracker. A **GitHub Actions** job runs **twice a day**, checks
the official recruitment sites, detects new/changed officer-entry notifications,
works out whether **you** are eligible, and **emails you** — even when the answer is
NOT ELIGIBLE (so you never miss IMA/AFA "watch" entries). A tiny retro one-page UI
on **Netlify** shows the current state. No server, no database.

## Profile used for eligibility

- DOB: **03 September 2003**
- Qualification: **B.Tech CSE**
- NCC: **No**

Edit these in [`src/config.js`](src/config.js).

## What it tracks

CDS (IMA/INA/AFA/OTA), CAPF AC, AFCAT (Flying + Ground Duty Tech/Non-Tech),
Army TGC, Army SSC Tech, Navy SSC IT and other Navy SSC officer entries.
NDA / Agniveer / TES / GATE / NCC-special are ignored.

Every entry is labelled **ELIGIBLE / NOT ELIGIBLE / ELIGIBILITY UNCERTAIN**.
Age is checked deterministically from the notification's born-between dates.
Technical branches are only marked ELIGIBLE if CSE/IT is actually listed —
otherwise UNCERTAIN (never assumed).

## Nothing is stored permanently

State lives in [`public/data/notifications.json`](public/data/notifications.json).
Each record is deleted **2 days** after it stops appearing on the official site
(`PRUNE_DAYS` in `src/config.js`).

## Setup

### 1. Email secrets (Gmail example)

Create a Gmail **App Password** (Google Account → Security → App passwords), then in
your GitHub repo: **Settings → Secrets and variables → Actions → New secret**:

| Secret | Value |
| --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | your gmail address |
| `SMTP_PASS` | the 16-char app password |
| `MAIL_TO` | where to receive alerts |
| `MAIL_FROM` | (optional) same as `SMTP_USER` |

### 2. Enable the workflow

Push this folder as a repo. The schedule in
[`.github/workflows/track.yml`](.github/workflows/track.yml) runs at 07:00 and
18:00 IST. Trigger a manual test run from the **Actions** tab (`workflow_dispatch`).

### 3. Deploy the UI on Netlify

New site from the repo. Netlify reads [`netlify.toml`](netlify.toml)
(`publish = "public"`). Done.

## Local test (no email sent)

```powershell
cd GovNoti
npm install
npm run track:dry   # prints the emails it WOULD send
```

> The official government notification PDF is always the final authority.
> Verify it before applying.
