# Sipher Auto-Deploy

Pulls new commits from GitHub and restarts services. Two modes:

## Mode A: Cron (simple)
```bash
chmod +x update.sh
(crontab -l 2>/dev/null; echo "*/5 * * * * /home/sipher/deploy/update.sh") | crontab -
```

## Mode B: Systemd timer (reliable)
```bash
sudo -S -p '' cp systemd/sipher-deploy.service /etc/systemd/system/
sudo -S -p '' cp systemd/sipher-deploy.timer /etc/systemd/system/
sudo -S -p '' systemctl daemon-reload
sudo -S -p '' systemctl enable --now sipher-deploy.timer
```

## Mode C: Instant deploy (SSH alias)
After `git push` from your laptop, trigger the Pi instantly:
```powershell
ssh -i C:\Users\indra\.ssh\id_rsa sipher@192.168.1.35 "/home/sipher/deploy/update.sh"
```
Add to your PowerShell profile as `git-push-and-deploy`.

## Log
`/home/sipher/deploy/pull.log` — all fetch/pull/restart activity.
