#!/bin/bash

sudo apt update
sudo apt upgrade -y
sudo apt install -y git build-essential vim zsh gawk postgresql iptables coturn

echo "CREATE USER nestrischamps with encrypted password 'nestrischamps'; CREATE DATABASE nestrischamps with owner=nestrischamps;" | sudo -u postgres psql

DB_URL="postgres://nestrischamps:nestrischamps@localhost:5432/nestrischamps?sslmode=disable"

mkdir -p src
cd src
git clone https://github.com/nestrischamps/nestrischamps.git
cd nestrischamps
mkdir -p logs
git checkout main

cat setup/db.sql | psql "${DB_URL}"

sudo apt-get install -y ca-certificates curl gnupg
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

NODE_MAJOR=20

echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list

sudo apt-get update
sudo apt install -y nodejs

npm install
sudo npm install peer -g

# generate the server keys
openssl req -x509 \
  -sha256 \
  -nodes \
  -newkey rsa:2048 \
  -days 3650 \
  -subj "/C=SG/O=Yobi/OU=Nestrischamps/CN=nestrischamps.local/" \
  -keyout nestrischamps.local.key \
  -out nestrischamps.local.crt

sed -r -i 's/isLocalRpi = false/isLocalRpi = true/g' public/views/constants.js

SESSION_SECRET=$(echo "console.log(require('ulid').ulid())" | node)
PORT=5443
TLS_KEY_PATH=/home/yobi/src/nestrischamps/nestrischamps.local.key
TLS_CERT_PATH=/home/yobi/src/nestrischamps/nestrischamps.local.crt

tee .env > /dev/null << EOF
TLS_KEY=${TLS_KEY_PATH}
TLS_CERT=${TLS_CERT_PATH}
PORT=${PORT}
DATABASE_URL=${DB_URL}
SESSION_SECRET=${SESSION_SECRET}
FF_SAVE_GAME_FRAMES=1
EOF

sudo tee /etc/systemd/system/nestrischamps.service > /dev/null << EOF
[Unit]
Description=NesTrisChamps Service
Requires=postgresql.service

[Service]
User=yobi
Type=simple
WorkingDirectory=/home/yobi/src/nestrischamps
ExecStart=/usr/bin/node -r dotenv/config /home/yobi/src/nestrischamps/server.js
StandardOutput=file:/home/yobi/src/nestrischamps/logs/stdouterr.log
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/peerjs.service > /dev/null << EOF
[Unit]
Description=PeerJS Service

[Service]
User=yobi
Type=simple
ExecStart=/usr/bin/peerjs --port 9000 --key peerjs --path / --sslkey ${TLS_KEY_PATH} --sslcert ${TLS_CERT_PATH}
StandardOutput=file:/home/yobi/src/nestrischamps/logs/peerjs.log
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/coturn.service > /dev/null << EOF
[Unit]
Description=coTURN service
After=systemd-networkd-wait-online.service
Wants=systemd-networkd-wait-online.service

[Service]
User=yobi
Type=simple
ExecStart=/usr/bin/turnserver --log-file stdout --cert ${TLS_CERT_PATH} --pkey ${TLS_KEY_PATH}
StandardOutput=file:/home/yobi/src/nestrischamps/logs/coturn.log
Restart=always

[Install]
WantedBy=multi-user.target
After=
EOF

sudo sed -i -E -e '/ExecStart/s/( --operational-state=routable)*$/ --operational-state=routable/' /lib/systemd/system/systemd-networkd-wait-online.service

sudo systemctl daemon-reload

sudo systemctl enable \
  systemd-networkd.service \
  systemd-networkd-wait-online.service \
  postgresql \
  nestrischamps \
  peerjs \
  coturn

sudo systemctl daemon-reload
sudo systemctl restart nestrischamps
sudo systemctl restart peerjs
sudo systemctl restart coturn

sudo iptables -t nat -A PREROUTING -i eth0 -p tcp --dport 443 -j REDIRECT --to-port ${PORT}

sleep 5

echo iptables-persistent iptables-persistent/autosave_v4 boolean true | sudo debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | sudo debconf-set-selections

sudo apt install -y iptables-persistent

# generate public key fingerprint to tell OBS we trust the server
PUB_KEY_FINGERPRINT=$(openssl x509 -in ${TLS_CERT_PATH} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64)

echo
echo ========== IMPORTANT ==========
echo
echo "Start OBS at the command line with this argument:"
echo "--ignore-certificate-errors-spki-list=${PUB_KEY_FINGERPRINT}"
