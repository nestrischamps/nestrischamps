#!/bin/bash

sudo apt update
sudo apt upgrade -y
sudo apt install -y git build-essential vim zsh gawk postgresql coturn

# Install oh-my-zsh without user interaction
sudo chsh -s $(which zsh) "$(whoami)"
export RUNZSH=no
export KEEP_ZSHRC=yes
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" --unattended

echo "CREATE USER nestrischamps with encrypted password 'nestrischamps'; CREATE DATABASE nestrischamps with owner=nestrischamps;" | sudo -u postgres psql

DB_URL="postgres://nestrischamps:nestrischamps@localhost:5432/nestrischamps?sslmode=disable"

cd ~ # go to home dir
mkdir -p src
cd src

git clone https://github.com/nestrischamps/nestrischamps.git
cd nestrischamps
mkdir -p logs
git checkout main

cat setup/db.sql | psql "${DB_URL}"

# install nodejs - see documentation https://github.com/nodesource/distributions#installation-instructions-deb
NODE_MAJOR=22
curl -fsSL https://deb.nodesource.com/setup_$NODE_MAJOR.x | sudo -E bash -
sudo apt install -y nodejs

npm install
sudo npm install peer -g

HOSTNAME=nestrischamps.local

# generate the server keys
openssl req -x509 \
  -sha256 \
  -nodes \
  -newkey rsa:2048 \
  -days 3650 \
  -subj "/C=SG/O=Yobi/OU=Nestrischamps/CN=${HOSTNAME}/" \
  -keyout ${HOSTNAME}.key \
  -out ${HOSTNAME}.crt

tee public/views/constants.js > /dev/null << EOF
export const peerServerOptions = {
	host: '${HOSTNAME}',
	path: '/',
	port: 9000,
	secure: true,
	config: {
		iceServers: [
			{ urls: ['stun:${HOSTNAME}:3478'] },
			{
				urls: ['turn:${HOSTNAME}:3478'],
				username: 'ntc',
				credential: 'ntc',
			},
		],
	},
};
EOF


SESSION_SECRET=$(echo "console.log(require('ulid').ulid())" | node)
PORT=5443
TLS_KEY_PATH=/home/yobi/src/nestrischamps/${HOSTNAME}.key
TLS_CERT_PATH=/home/yobi/src/nestrischamps/${HOSTNAME}.crt

tee .env > /dev/null << EOF
TLS_KEY=${TLS_KEY_PATH}
TLS_CERT=${TLS_CERT_PATH}
PORT=${PORT}
DATABASE_URL=${DB_URL}
SESSION_SECRET=${SESSION_SECRET}
FF_SAVE_GAME_FRAMES=1

LOCAL_USERS_ALLOW_IMPORT=0
LOCAL_USERS_REFRESH=0
LOCAL_USERS_CSV_URL=
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


# create tables and chains if they do not exist
sudo nft 'add table ip  nat' 2>/dev/null || true
sudo nft 'add chain ip  nat PREROUTING { type nat hook prerouting priority -100; }' 2>/dev/null || true
sudo nft 'add table ip6 nat' 2>/dev/null || true
sudo nft 'add chain ip6 nat PREROUTING { type nat hook prerouting priority -100; }' 2>/dev/null || true

# add rules for port 443 redirection to our app port on both ipv4 and ipv6
sudo nft add rule ip  nat PREROUTING tcp dport 443 redirect to :"$PORT"
sudo nft add rule ip6 nat PREROUTING tcp dport 443 redirect to :"$PORT"

# persist
sudo nft list ruleset | sudo tee /etc/nftables.conf >/dev/null
sudo systemctl enable --now nftables


# generate public key fingerprint to tell OBS we trust the server
PUB_KEY_FINGERPRINT=$(openssl x509 -in ${TLS_CERT_PATH} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64)

echo
echo ========== IMPORTANT ==========
echo
echo "Start OBS at the command line with this argument:"
echo "--ignore-certificate-errors-spki-list=${PUB_KEY_FINGERPRINT}"
