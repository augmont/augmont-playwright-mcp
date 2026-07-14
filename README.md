# LGD Playwright MCP

Standalone Playwright test runner with a live MCP-style browser view for the Augmont LGD Portal.

## Features

1. **URL setup** — portal URL + location API URL (auto-suggested from portal host).
2. **Web suites** — Signup & Login (multi-country) plus all-role flows: buyer / seller / admin login, public smoke, and role navigation shells.
3. **AI (OpenRouter gpt-4o)** — prompt-wise generate test cases; upload JSON/MD/TXT to **replace** matching ids or **add** new ones (`OPENROUTER_API_KEY`).
4. **Run workspace (30% / 70%)** — step overview + live MCP screencast; country picker for Signup & Login.
5. **Last 5 reports** — inside the workspace via **Reports** drawer; PDF under `data/reports/`.

## Quick start

```bash
cd /Users/ravirajpatel/Desktop/Augmont/lgd-playwright-mcp
npm install
npx playwright install chromium
cp .env.example .env.local   # add OPENROUTER_API_KEY
npm run dev
```

Open [http://localhost:3100](http://localhost:3100).

1. Enter **Portal URL** (`http://localhost:4200`) and **API URL** (`http://localhost:3000/api/v1`)
2. On **Web test cases**: use **Generate with AI** or **Upload**, then open a suite
3. For Signup & Login: choose **All countries** or **Single country**, then **Start test**

## Project layout

```
src/
  app/                  # Next.js pages + API
  components/           # UI (incl. WebAiPanel)
  lib/                  # store, registry, types
  server/               # Playwright runners, OpenRouter AI, web-test store
    tests/              # signup flow fixtures
data/                   # web-test-cases.json + run reports (gitignored)
```

## Notes

- Full signup path: form → Continue & Receive OTP → verify OTP (`123456` in test/dev/uat) → company details → login.
- Buyer web flows use **ensureBuyer**: signup once per browser tab, save email/password in the server session store for that tab (`sessionStorage` id). Close the tab → next run creates a new account.
- Seller/admin cannot be created via public signup; **role-guards** verifies `/seller` and `/admin` redirect to `/login` when logged out.
- Live view uses Chrome DevTools Protocol screencast frames streamed to the UI.
- This project is fully separate from `lgd-portal` and `augmont-lgd-backend`.
