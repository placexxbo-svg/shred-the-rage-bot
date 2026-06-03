# 🗂️ Shredder Bot — Discord Stress Relief

Destroy toxic messages with satisfying visual shredding. Three slash commands, zero therapy bills.

---

## Commands

| Command | What it does |
|---|---|
| `/shred [message]` | Visually destroys your message in 3 stages |
| `/shredcount` | Shows your personal destruction tally (private) |
| `/cooldown` | Sends you a calming affirmation (private) |

---

## Setup (5 minutes)

### 1. Create your bot on Discord
1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it (e.g. "Shredder")
3. Go to **Bot** tab → click **Add Bot**
4. Under **Token** → click **Reset Token** and copy it
5. Under **Privileged Gateway Intents** — no extras needed for this bot
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`
   - Copy the generated URL and open it to invite the bot to your server

### 2. Get your Client ID
- In your app's **General Information** tab, copy the **Application ID** (this is your CLIENT_ID)

### 3. Install & run

```bash
npm install
```

Set your environment variables:

```bash
# Linux/Mac
export DISCORD_TOKEN=your_bot_token_here
export CLIENT_ID=your_application_id_here
node bot.js

# Windows CMD
set DISCORD_TOKEN=your_bot_token_here
set CLIENT_ID=your_application_id_here
node bot.js
```

Or create a `.env` file and use the `dotenv` package:

```
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
```

Then add to bot.js top: `require('dotenv').config();`

### 4. You're live!
Slash commands register on startup. Type `/shred` in any channel your bot has access to.

---

## Hosting (optional)
- **Railway** / **Render** / **Fly.io** — free tiers work great for small bots
- Set the env vars in the platform's dashboard
- Point it at `node bot.js`

---

## Customization ideas
- Add more shred characters or stages
- Add a `/vent` command that listens and responds with AI empathy
- Store shred counts in a database (SQLite, Postgres) for persistence across restarts
- Add a `/leaderboard` to see who's the most stressed on the server 😅
