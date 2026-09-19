# improved-palm-tree v2.0 (Fixed)

Discord video streaming selfbot with:
- Encrypted SQLite state
- Seek / bookmarks
- Auto resume when you join voice
- Fixed `ERR_MODULE_NOT_FOUND` (libsodium)
- Cleaner error handling & less lag

## ⚠️ Important
Selfbots violate Discord Terms of Service. Use at your own risk. Account ban is possible.

## Requirements
- Node.js 18+
- FFmpeg installed and available in PATH
- Discord user token (not bot token)

## Install
```bash
npm install
```

## Run
```bash
export TOKEN="your_discord_user_token"
export KAMBIZ_ID="your_discord_user_id"
npm start
```

Or on Windows (PowerShell):
```powershell
$env:TOKEN="your_token"
$env:KAMBIZ_ID="your_id"
npm start
```

## Commands (send as yourself)
| Command | Description |
|---------|-------------|
| `!setvid <url>` | Set video URL and reset time |
| `!seek <seconds>` | Jump to time |
| `!stop` | Stop stream and save progress |
| `!hot` / `!mark [note]` | Add bookmark |
| `!marks` | List bookmarks |
| `!status` | Show current status |

## What was fixed
- Missing `package.json` and dependencies
- `ERR_MODULE_NOT_FOUND` for libsodium-wrappers
- Mixed require / dynamic import issues
- Unhandled promise rejections
- Interval not cleaned on stop
- Fragile git push that could crash the process
- Better error messages

## Notes
- FFmpeg must be installed.
- The DB is encrypted with a key derived from the token.
- GitHub auto-push is best-effort and optional.

---

## GitHub Actions (اجرای روی سرور GitHub)

فایل `.github/workflows/bot.yml` آماده است.

### تنظیمات لازم در ریپازیتوری:

1. برو به **Settings → Secrets and variables → Actions**
2. این سه Secret را اضافه کن:

| Name        | Value                          |
|-------------|--------------------------------|
| `TOKEN`     | توکن یوزر دیسکورد              |
| `KAMBIZ_ID` | آیدی عددی اکانت خودت           |
| `GH_TOKEN`  | (اختیاری) Personal Access Token با دسترسی `repo` اگر می‌خواهی DB را push کند |

3. برو به تب **Actions** → workflow به نام **Kambiz Ghost Streamer** را انتخاب کن → **Run workflow**

ربات هر ۴ ساعت یک‌بار (یا دستی) روی runner گیت‌هاب اجرا می‌شود.
