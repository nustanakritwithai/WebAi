# Deploy WebAi secure Typhoon proxy (Ubuntu/Debian)

This deployment has one job: keep the OpenTyphoon credential on the VPS and proxy `/api/typhoon/chat`. The Node process listens only on `127.0.0.1:8787`; Nginx exposes HTTPS.

1. Install Node.js 20+, Nginx, and Certbot. Create a least-privilege service account:

   ```bash
   sudo useradd --system --home /opt/webai --shell /usr/sbin/nologin webai
   sudo install -d -o webai -g webai /opt/webai /etc/webai
   ```

2. Deploy this repository to `/opt/webai` without copying a local `.env`, then make the directory readable by the service account:

   ```bash
   sudo chown -R webai:webai /opt/webai
   ```

3. Create `/etc/webai/typhoon-proxy.env` on the VPS only. It must be mode `640`, owned by `root:webai`, and contain exactly the variables from `.env.example` with the real value substituted locally.

   ```bash
   sudo install -m 640 -o root -g webai /dev/null /etc/webai/typhoon-proxy.env
   sudoedit /etc/webai/typhoon-proxy.env
   ```

4. Install and enable the service:

   ```bash
   sudo install -m 644 deploy/webai-typhoon-proxy.service /etc/systemd/system/webai-typhoon-proxy.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now webai-typhoon-proxy
   sudo systemctl status webai-typhoon-proxy --no-pager
   ```

5. Replace `YOUR_VPS_HOST` in `deploy/nginx/webai-typhoon-proxy.conf`, obtain the certificate, install the Nginx site, and validate it:

   ```bash
   sudo certbot certonly --nginx -d YOUR_VPS_HOST
   sudo install -m 644 deploy/nginx/webai-typhoon-proxy.conf /etc/nginx/sites-available/webai-typhoon-proxy
   sudo ln -s /etc/nginx/sites-available/webai-typhoon-proxy /etc/nginx/sites-enabled/webai-typhoon-proxy
   sudo nginx -t
   sudo systemctl reload nginx
   ```

Restart after a source or environment update:

```bash
sudo systemctl restart webai-typhoon-proxy
sudo systemctl status webai-typhoon-proxy --no-pager
```

Verification (do not put credentials in the command):

```bash
curl -fsS https://YOUR_VPS_HOST/api/health
curl -i -X POST https://YOUR_VPS_HOST/api/typhoon/chat \
  -H 'Origin: https://untrusted.example' \
  -H 'Content-Type: application/json' \
  --data '{"messages":[{"role":"user","content":"test"}]}'
sudo journalctl -u webai-typhoon-proxy -n 100 --no-pager
```

The log command is only for checking that application output has no credential value. Do not copy `/etc/webai/typhoon-proxy.env` into Git, tickets, chat, or shell history.
