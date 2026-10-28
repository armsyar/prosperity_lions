# Prosperity Lions: CNY prototype

A clickable prototype of the Prosperity Lions Chinese New Year guest experience.

| Page | Path |
|---|---|
| Personality quiz + lion chat | `/` |
| Lion Dance Party drum game | `/game/` |
| Lucky Hongbao rewards | `/hongbao/` |
| Chat proxy (not part of the website) | `worker/worker.js` + `wrangler.jsonc` |
| Chat troubleshooting page | `/check.html` |

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

The chat goes through a small Cloudflare Worker (`worker/worker.js`) that holds your Claude API key. Cloudflare builds it **straight from this repo**, using `wrangler.jsonc`. That file names the Worker, sets which site may use it, and pins it to **US East**. That matters because Cloudflare sometimes runs Workers for Singapore visitors in Hong Kong, and Claude refuses requests from Hong Kong.

The API key must **never** go into this repo, because everything here is public. It is typed into Cloudflare only.

### A. Get an API key
1. Go to **console.anthropic.com** and sign in.
2. Check **Billing** has credit, and set a monthly **spend limit** (e.g. USD 20).
3. **API Keys → Create Key**, name it `prosperity-lions`, and copy it. You only see it once.

### B. Create the Worker from this repo
1. Go to **dash.cloudflare.com → Workers & Pages → Create**.
2. Choose **Import a repository** (Continue with GitHub) and allow Cloudflare to see this repo.
3. Pick **prosperity_lions**. On the setup screen:
   - **Project name:** `lion-chat-api` (must match `name` in `wrangler.jsonc`)
   - **Build command:** leave empty
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/` (leave as is)
4. Click **Deploy** and wait for the build to finish.

### C. Add the key
1. Open the Worker **lion-chat-api → Settings → Variables and Secrets** (the runtime section, *not* under Build).
2. **+ Add** → Type **Secret** → Name `ANTHROPIC_API_KEY` → paste the key → **Deploy**.

### D. Check it
Open `https://lion-chat-api.<your-subdomain>.workers.dev/?test=1`:
- `runs_in` should be a US code such as `IAD`, `EWR` or `ORD`, **not** `HKG`.
- `claude_test` should say **PASS**. If not, `what_to_do` says why.

`config.js` must point to that address:
```js
window.LION_CHAT_API = 'https://lion-chat-api.<your-subdomain>.workers.dev';
```
Then open `check.html` on the site and tap **Run check**. Every step should pass.

### Day-to-day
- **Key expired or replaced:** update only the `ANTHROPIC_API_KEY` secret in Cloudflare (step C). Nothing on GitHub changes.
- **Changing the Worker or the allowed site:** edit `worker/worker.js` or `wrangler.jsonc` on GitHub. Cloudflare rebuilds automatically.
- **Chat says "drums were too loud":** run `check.html`. The failing step shows the reason.

---

## What the proxy protects, and what it doesn't
- ✅ The API key is never sent to the browser.
- ✅ Only your site's address is accepted, in the browser.
- ✅ Replies are capped at 400 tokens, conversations at 20 turns, and each visitor is rate-limited on a best-effort basis.
- ⚠️ A determined person could still call the Worker from outside a browser and use it as a general chatbot, within those caps. **The Console spend limit is your real safety net**, so keep it set. A production build should build the lion's instructions on the server and put the Worker behind Cloudflare's rate-limiting and bot protection (see the Technical Build Plan).

## Other prototype limits
- Hongbao prizes are random, and vouchers are marked DEMO.
- No guest data is stored. Chat history resets when the page is reloaded.
