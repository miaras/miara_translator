#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm run build
if [ -f /var/lib/translator/store.json ]; then
    install -d -m 700 /var/backups/shiroko-translator
    install -m 600 /var/lib/translator/store.json "/var/backups/shiroko-translator/store-$(date -u +%Y%m%dT%H%M%SZ).json"
fi
test -f .env
install -d /srv/translator
cp -a dist server.js openai-translation.js pricing.js source-tokens.js polar.js subscription-plans.js subscriptions.js allowance-billing.js photo-pricing.js photo-ocr.js social-auth.js referral.js human-review.js human-review-pricing.js human-review-notifications.js interface-geolocation.js package.json package-lock.json /srv/translator/
npm ci --omit=dev --prefix /srv/translator
install -m 600 .env /etc/translator.env
cat > /etc/systemd/system/translator.service <<'EOF'
[Unit]
Description=Shiroko Translator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
DynamicUser=yes
WorkingDirectory=/srv/translator
Environment=HOST=127.0.0.1
Environment=PORT=3002
Environment=SHIROKO_DATA_FILE=/var/lib/translator/store.json
EnvironmentFile=/etc/translator.env
StateDirectory=translator
ExecStart=/usr/bin/node /srv/translator/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/caddy/sites/translator.caddy <<'EOF'
translate.shiroko.tools {
    encode zstd gzip
    header {
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        X-Frame-Options DENY
        -Server
    }
    reverse_proxy 127.0.0.1:3002
}
EOF
if ! grep -q '^import /etc/caddy/sites/translator.caddy$' /etc/caddy/Caddyfile; then
    printf '\nimport /etc/caddy/sites/translator.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now translator
systemctl restart translator
systemctl reload caddy
