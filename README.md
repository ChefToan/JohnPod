# JohnPod

Just a simple helpful discord bot for me and my fellow CAs.

## Features

- `/menu` - Browse ASU dining hall menus with interactive buttons (period, station, items)
- `/sus` - Sends sussy gif
- Weekly Report Pings - Automated Sunday reminders at 12 PM and 9 PM Arizona time

## Tech Stack

- Discord.js - Bot framework
- TypeScript - Type-safe codebase
- Axios - ASU CampusDish API client
- systemd - Process manager for production

## Setup

1. Clone and install:
   ```bash
   git clone https://github.com/ChefToan/JohnPod.git
   cd JohnPod
   npm install
   ```

2. Create `.env`:
   ```
   DISCORD_TOKEN=your_token
   APPLICATION_ID=your_app_id
   ```

3. Build and run:
   ```bash
   npm run build
   npm start
   ```

## Development

```bash
npm run dev        # Watch mode with auto-restart
npm run typecheck  # Type checking
npm run lint       # Lint
```

## Production (systemd)

Copy the service file and enable it:
```bash
sudo cp deploy/systemd-service.example /etc/systemd/system/johnpod.service
sudo systemctl daemon-reload
sudo systemctl enable johnpod
sudo systemctl start johnpod
```

Manage the service:
```bash
sudo systemctl status johnpod      # Check status
sudo systemctl restart johnpod     # Restart
journalctl -u johnpod -f           # Follow logs
journalctl -u johnpod --since today # Today's logs
```

Deploy updates manually:
```bash
cd /home/ubuntu/johnpod
git pull origin main
npm ci
npm run build
npm prune --production
sudo systemctl restart johnpod
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `APPLICATION_ID` | Yes | Discord application ID |
| `ENABLE_WEEKLY_REPORTS` | No | Set to `"true"` to enable Sunday pings |
| `PRODUCTION_CA_ROLE_ID` | No | Role to ping for weekly reports |
| `PRODUCTION_SERVER_ID` | No | Production server ID |
| `PRODUCTION_CHANNEL_ID` | No | Channel for weekly report pings |
| `WEEKLY_REPORT_SURVEY_URL` | No | Survey link included in pings |
| `ASU_MENU_API_URL` | No | Override default CampusDish API URL |

## Author

Toan - [ChefToan](https://github.com/ChefToan)
