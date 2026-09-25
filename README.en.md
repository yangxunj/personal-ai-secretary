# Personal AI Secretary

[中文](README.md) | **English**

An AI life secretary that runs on your own computer. You tell it things in a chat,
and it files away your to-dos, accounts, bills, medical checkup reports and insurance
policies, so they're right there when you need them.

**All your data stays on your own computer.** No server, no account, no telemetry.
The one exception: when you chat with the AI, what you send goes to the model
provider you chose.

> ⚠ **The interface is Chinese-only for now.** The AI replies in whatever language
> you write in, but menus, pages and labels are in Chinese. The finance module
> assumes a single base currency (CNY by default).

![Chat](docs/images/chat.jpg)

## What it does

Talk to it like you'd text a person:

| You say | It does |
| --- | --- |
| "Renew the car insurance before next Wednesday" | Creates a to-do and works out the due date |
| "Remember my bank card number is 6225…" | Saves it to the vault; ask later to look it up, copy with one tap |
| "What's still pending?" | Checks the task list and answers truthfully |
| Drop in a bank statement screenshot | Reads it line by line into the ledger, **reconciles against the opening/closing balance**, and tells you by how much if it misread something |
| Drop in a checkup report | Records each metric in the health archive, flags abnormal ones, shows trends across checkups |
| "Make a page showing where the money went these months" | Queries the real data and builds a chart page, saved under "Pages" |
| "Make a snake game for my kid" | Builds a playable mini game (8 sample pages ship with the app) |

Also:

- **Multiple conversations**: one topic per conversation, auto-titled. The vault, tasks and pages are shared, so every conversation can see them.
- **Insurance ledger**: when each policy's next premium is due.
- **Topics**: an ongoing matter (renovation, buying a car) with its related tasks and a list of "things we haven't figured out yet".
- **Phone access**: pair your phone by QR code on the same Wi-Fi and use it in the mobile browser. Add it to your home screen and it feels like an app.
- **Household members**: tasks can be assigned to different people at home.

<p>
<img src="docs/images/pages.jpg" width="62%" alt="Pages">
<img src="docs/images/phone.jpg" width="30%" alt="On a phone">
</p>

## Download (Windows)

Grab one from [Releases](../../releases):

| File | Where your data lives | Best for |
| --- | --- | --- |
| `personal-ai-secretary-Setup-<version>.exe` | `%APPDATA%\家庭管家\data\` | Most people. Install once, get desktop and Start menu shortcuts |
| `personal-ai-secretary-<version>-win.zip` | `data\` inside the unzipped folder | No install. Unzip and run; copy the whole folder to a USB stick to take it with you |
| `personal-ai-secretary-portable-<version>.exe` | `data\` next to the exe | Single-file, no install. Unpacks itself on every launch, so cold start is slow |

Once installed, the app is called 「家庭管家」 ("Household Steward").

The installers aren't code-signed, so Windows will say "Windows protected your PC".
Click **More info → Run anyway**. If you'd rather not, build it yourself (see below).

Windows only for now.

## First run

1. **Enter an AI model key.** Menu 「设置 → AI 模型 / API Key…」 (Settings → AI model / API key), pick a provider, paste the key, click 「保存并测试」 (Save and test).
   - **Alibaba Cloud Model Studio (Bailian)**: create a key on the "API-KEY" page of the [console](https://bailian.console.aliyun.com/)
   - **DeepSeek**: "API keys" at [platform.deepseek.com](https://platform.deepseek.com/)
   - Any other OpenAI-compatible endpoint works too; fill in the base URL and model name yourself. Reading bills and checkup reports needs a **vision-capable** model.
2. **Settings → 家里的人 (household members)**: list who's in your household so tasks can be assigned to them.
3. Go to 「对话」 (Chat) and say something.

It works without a key too: tasks, the vault and so on can all be edited by hand, you just can't chat.

## Privacy

- The database (SQLite), uploaded originals and backups all live in that `data` folder. Menu 「设置 → 打开数据文件夹」 (Settings → Open data folder) takes you there.
- The app itself sends no telemetry. **Text and images you send in a chat go to your chosen model provider**; the AI has to read a bill to enter it for you. If you don't want the AI to see something, don't send it; enter it by hand.
- Sensitive values are stored **in plain text** in the local database (that's how the AI can look them up). Protection relies on the computer itself: don't hand the `data` folder to anyone.
- Phone access is off by default. When on, only devices paired by QR code can get in. Pairing codes are single-use and expire after 10 minutes, and devices can be removed at any time.

## Build from source

Requires Node.js 22+.

```bash
npm install
cp .env.example .env          # local dev config; the AI key can stay empty and be set in Settings later
npx prisma db push            # create the database
node scripts/seed-demo.mjs    # optional: load demo data
npm run dev                   # http://localhost:3096
```

Build the desktop app:

```bash
cd desktop
npm install
npm run dist                  # → desktop/dist/, installers contain no API key
```

`npm run dist` runs `node scripts/prepare.mjs --no-key` first. ⚠ If you ever run
`prepare.mjs` **without** `--no-key`, the `AI_API_KEY` in `.env` gets baked into the
installer, and anyone who has the installer can extract it.

## Layout

```
src/app/(app)/     Pages: chat, tasks, vault, finance, health, topics, pages, files, settings
src/app/api/chat/  Chat endpoint (AI SDK, OpenAI-compatible)
src/lib/           agent-tools (tools the AI can call), queries, page sandbox, import logic
prisma/            Data model
scripts/           CLI (secretary.mjs), demo data, backups
samples/pages/     The 8 sample pages bundled in "Pages"
desktop/           Electron shell, phone-access gateway (lan.js), packaging scripts
docs/              Developer notes (Chinese)
```

Before changing code, read [`docs/开发笔记.md`](docs/开发笔记.md) and
[`desktop/README.md`](desktop/README.md) (both in Chinese; code comments are in Chinese too).

## Status

Early days. The author's own family uses it.

- **The data model will still change.** Upgrades try to add new columns automatically, but don't treat this as your only copy for now; keep important things elsewhere too.
- No auto-update. New versions have to be downloaded and installed over the old one (your data is kept).
- Not done yet: memory across conversations, letting the AI re-read previously uploaded originals, wiring topics and documents into chat.

Issues and suggestions are welcome via [Issues](../../issues). This is a personal
project: I'll read them, but can't promise a quick reply.

## License

[AGPL-3.0](LICENSE). Free to use, modify and redistribute. **If you run a modified
version as a service for others (including as a website), you must publish its
source code too.**
