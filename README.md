# Prosperity Lions: CNY prototype

A clickable prototype of the Prosperity Lions Chinese New Year guest experience.

| Page | Path |
|---|---|
| Personality quiz + lion chat | `/` |
| Lion Dance Party drum game | `/game/` |
| Lucky Hongbao rewards | `/hongbao/` |
| Chat proxy (not part of the website) | `worker/worker.js` |

The pages link to each other with relative paths, so the whole flow works from one URL. Each page keeps its own `img/` and `clips/` folders, so don't move them.

---

## Part 1: Publish the site (GitHub Pages)
1. Create a **public** repository on GitHub, e.g. `prosperity-lions`.
2. Upload the files. GitHub's web uploader takes **at most 100 files at a time**, so do it in two batches, clicking **Commit changes** after each:
   - **Batch 1:** `index.html`, `config.js`, `manifest.webmanifest`, `README.md`, and the `img`, `icons` and `worker` folders
   - **Batch 2:** the `clips`, `game` and `hongbao` folders

   (Or use **GitHub Desktop**, which has no limit.)
3. In the repo go to **Settings → Pages**. Set **Source** to *Deploy from a branch*, choose branch `main` and folder `/ (root)`, then save.
4. About a minute later the site is live at `https://<your-username>.github.io/<repo-name>/`.

The chat stays switched off until you finish Part 2.

### Install it like an app
Open the link on a phone, then:
- **iPhone (Safari):** tap Share → **Add to Home Screen**
- **Android (Chrome):** tap ⋮ → **Add to Home screen** / **Install app**

A lion icon appears on the home screen, and the app opens full-screen with no browser bar. The quiz, game and hongbao all stay inside the app.

---

## Part 2: Switch on the live chat

The API key must **never** go into this repo, because everything here is public. It lives only in the Cloudflare Worker.

### A. Get an API key
1. Go to **console.anthropic.com** and sign in or sign up.
2. Add billing (credits or a card) in the Console's **Billing** settings.
3. Set a monthly **spend limit** in the Console's **Limits** settings (for example USD 20 while you test).
4. Go to **API Keys → Create Key**, name it `prosperity-lions`, and copy it. You only see it once.

### B. Create the Worker
1. Sign up free at **dash.cloudflare.com**.
2. Go to **Workers & Pages → Create → Create Worker** (the "Hello World" starter), name it `prosperity-lions-chat`, and click **Deploy**.
3. Click **Edit code**. Delete everything, paste in the whole of `worker/worker.js` from this repo, and click **Deploy**.
4. Copy the Worker address shown, e.g. `https://prosperity-lions-chat.yourname.workers.dev`.

### C. Add the settings
In the Worker go to **Settings → Variables and Secrets → Add**:

| Type | Name | Value |
|---|---|---|
| **Secret** | `ANTHROPIC_API_KEY` | the key from step A |
| Text | `ALLOWED_ORIGIN` | `https://<your-username>.github.io` (no slash at the end, no repo name) |
| Text (optional) | `MAX_PER_HOUR` | messages per visitor per hour, default `30` |
| Text (optional) | `MODEL` | defaults to `claude-haiku-4-5-20251001` |

Click **Deploy** / **Save** so the settings take effect.

### D. Point the site at the Worker
1. On GitHub, open `config.js` and click the pencil icon to edit.
2. Paste the Worker address between the quotes:
   ```js
   window.LION_CHAT_API = 'https://prosperity-lions-chat.yourname.workers.dev';
   ```
3. Commit. After about a minute, reload the site and chat with your lion.

### If the chat doesn't answer
- **"Oops, the drums were too loud…"**: open the Worker in Cloudflare and check **Logs**. `origin_not_allowed` means `ALLOWED_ORIGIN` doesn't exactly match your site's address. `missing_api_key` means the secret wasn't saved. An upstream error usually means a wrong key or no billing credit.
- **"All out of breath"**: the visitor hit the hourly limit, or the Claude API is busy.
- **Still says chat is switched off**: `config.js` is empty, or GitHub Pages hasn't updated yet.

---

## What the proxy protects, and what it doesn't
- ✅ The API key is never sent to the browser.
- ✅ Only your site's address is accepted, in the browser.
- ✅ Replies are capped at 400 tokens, conversations at 20 turns, and each visitor is rate-limited on a best-effort basis.
- ⚠️ A determined person could still call the Worker from outside a browser and use it as a general chatbot, within those caps. **The Console spend limit is your real safety net**, so keep it set. A production build should build the lion's instructions on the server and put the Worker behind Cloudflare's rate-limiting and bot protection (see the Technical Build Plan).

## Other prototype limits
- Hongbao prizes are random, and vouchers are marked DEMO.
- No guest data is stored. Chat history resets when the page is reloaded.
