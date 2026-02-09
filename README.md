# JohnPod

Just a simple helpful discord bot for me and my fellow CAs.

## Setup

1. Clone and install:
   ```bash
   git clone https://github.com/ChefToan/JohnPod.git
   cd JohnPod
   npm ci
   ```

2. Create a `.env` file in the project root:
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

Deploy updates:
```bash
cd /home/ubuntu/johnpod
git pull origin main
npm ci
npm run build
sudo systemctl restart johnpod
```

## Author

Toan - [ChefToan](https://github.com/ChefToan)
