# Lock It In

All-or-nothing trip deposits. Everyone puts down a deposit by the deadline, or the trip is off and every deposit is refunded.

Built as an MVP to test one research question:

> When Maya's friend group gets an all-or-nothing commit page with a 72-hour deadline and a real deposit, do at least 6 of 10 groups fully commit before the clock runs out?

## Run it on Replit

1. Go to replit.com and create a new Repl using the **Node.js** template.
2. Delete the starter `index.js` file.
3. Unzip this folder on your computer and drag everything inside it (including the hidden `.replit` file) into the Replit file panel.
4. Press **Run**. Replit installs Express and starts the server.
5. Open the web preview. You'll see the "Start a trip" page.

To see a filled-in example right away, add `/t/demo` to the preview URL. For the organizer view of the demo, add `/t/demo?key=demo-organizer`.

## Run it on your computer

```
npm install
npm start
```

Open http://localhost:3000.

## Put it on the public internet (Render)

1. Put this folder in its own GitHub repo (see the commands below).
2. On render.com, go to **New > Blueprint** and pick the repo. Render reads `render.yaml` and creates a web service with a 1 GB disk.
3. Click **Apply**. In about 2 minutes the app is live at `https://lock-it-in-xxxx.onrender.com`.

For a free version instead, go to **New > Web Service**, pick the repo, and set:

- Build command: `npm ci`
- Start command: `npm start`
- Plan: **Free**

**Warning:** free Render services have no disk. Every trip is erased whenever the service restarts or redeploys, and it sleeps after 15 minutes idle. That's fine for showing the demo, but not for the real 10-group test.

## Put it on the public internet (Fly.io)

This gives you a permanent `https://` link anyone can open. Trip data is saved on a small disk, so it survives restarts.

1. Install flyctl (`brew install flyctl`) and log in (`fly auth login`).
2. In this folder, run:
   ```
   fly apps create <your-app-name>        # then set app = "<your-app-name>" in fly.toml
   fly volumes create lockitin_data --region bos --size 1 -a <your-app-name>
   fly deploy --ha=false
   ```
3. Your app is live at `https://<your-app-name>.fly.dev`.

Keep it to **one machine**. All the data is in one file, so two machines would each keep their own copy.

## Ready for public use

- **Organizer links are saved.** Every organizer link you create or open is listed under "Your trips on this device" on the home page.
- **Link previews.** Friend links show the trip name and deposit when pasted into iMessage, WhatsApp, or Slack.
- **The demo resets itself.** The public demo (`/t/demo`, organizer view at `/t/demo?key=demo-organizer`) restores itself every 30 minutes, so visitors can click around freely.
- **Spam protection.** Each IP address can create up to 30 trips per hour and make 120 changes per minute.
- **The organizer key stays private.** The key in the URL is never sent to other sites, and it is checked with a constant-time comparison.

## How it works

**The organizer (Maya)** fills out one form with the trip, the deposit, a deadline, her friends' names, and whichever payment apps she uses. She gets two links.

- The **friend link** goes in the group chat.
- The **organizer link** stays private. It lets her confirm deposits.

**Friends** open the link, pick their name, and choose how to pay. The options are Venmo, Cash App, PayPal, Zelle, Apple Cash, or cash in person. Venmo, Cash App, and PayPal open with the amount filled in. Zelle and Apple Cash show copy buttons for the handle, amount, and memo. After paying, the friend taps "I sent my $75" and their seat turns yellow.

**Maya confirms** each deposit when the money lands, and the seat turns green. Lock It In never touches money. Friends always pay Maya directly.

**The rule runs itself:**

- Every seat green means the trip is **LOCKED**.
- If the clock hits zero with an empty seat, the trip is **RELEASED**. Maya gets a refund checklist, and every friend sees that their money is coming back.
- If everyone said they paid before the deadline but Maya hasn't confirmed yet, the trip shows **CHECKING** instead of failing. That way a slow bank transfer doesn't sink the trip.

## Features that answer the research question

**Results panel.** The organizer view shows:
- how many seats are locked in
- how many people paid within 24 hours
- the median time to pay
- how long the trip took to fully lock
- how many nudges were sent
- which payment methods people used

**"What got in the way?"** When a trip fails, holdouts get one tap to say why. The options are dates, money, not sure, forgot, or something else, plus an optional note. Friends can also say "I can't make it" before the deadline. This turns a "no" into a reason, which tells you whether the real problem is commitment, dates, or cost.

**CSV export.** One click downloads every trip's data for analysis across all 10 test groups.

**Nudge message.** This is a ready-to-paste message naming who's still missing and how much time is left. The app counts how many nudges were sent, so you can see whether nudging matters.

## What's faked on purpose

- **Payments are confirmed by hand.** The organizer checks their own payment app and taps Confirm.
- **Refunds are sent by hand.** The organizer sends each one back and marks it refunded.
- **There are no logins.** Anyone with the friend link can pick any name. That's fine for friend groups, but not for a real product.

## Notes

- Data is saved in `data.json` (in `DATA_DIR` if set, otherwise the project folder). It's created automatically, and the demo trip is added on first run.
- On Replit, data persists while you run the project in the workspace or on a Reserved VM deployment. Autoscale deployments can reset files, so avoid them for a real 10-group test.
- To reset everything, stop the app, delete `data.json`, and press Run again.
