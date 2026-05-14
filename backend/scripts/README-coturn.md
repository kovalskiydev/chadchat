# TURN setup

Этот каталог содержит скрипт для поднятия `coturn` на отдельном сервере.

## Что делает скрипт

Файл [setup-coturn.sh](/Users/kvsociety/omoggle/backend/scripts/setup-coturn.sh):
- ставит `coturn` и `certbot`
- включает `coturn`
- запрашивает Let's Encrypt сертификат для домена
- пишет `/etc/turnserver.conf`
- перезапускает сервис

## Перед запуском

На каждый TURN сервер нужно:
1. отдельный VPS с публичным IP
2. DNS A-record:
   - `turn-asia.chadchat.fun -> ASIA_IP`
   - `turn-us.chadchat.fun -> US_IP`
3. открыть в cloud firewall:
   - `3478/tcp`
   - `3478/udp`
   - `5349/tcp`
   - `49152-65535/udp`

## Пример запуска для Азии

```sh
sudo DOMAIN=turn-asia.chadchat.fun \
  PUBLIC_IP=YOUR_ASIA_IP \
  REGION_NAME=asia \
  TURN_USERNAME=turnuser \
  TURN_PASSWORD='strong-random-password' \
  TURN_REALM=chadchat.fun \
  EMAIL=admin@chadchat.fun \
  ./scripts/setup-coturn.sh
```

## Пример запуска для США

```sh
sudo DOMAIN=turn-us.chadchat.fun \
  PUBLIC_IP=YOUR_US_IP \
  REGION_NAME=us \
  TURN_USERNAME=turnuser \
  TURN_PASSWORD='strong-random-password' \
  TURN_REALM=chadchat.fun \
  EMAIL=admin@chadchat.fun \
  ./scripts/setup-coturn.sh
```

## Что прописать в backend

После поднятия обоих TURN:

```env
WEBRTC_STUN_URL=stun:stun.l.google.com:19302
WEBRTC_TURN_URLS=turn:turn-asia.chadchat.fun:3478,turns:turn-asia.chadchat.fun:5349,turn:turn-us.chadchat.fun:3478,turns:turn-us.chadchat.fun:5349
WEBRTC_TURN_USERNAME=turnuser
WEBRTC_TURN_CREDENTIAL=strong-random-password
```

`duel-service` уже умеет отдавать это через:

```http
GET /duel/rtc-config
```

Фронт должен брать `ice_servers` только оттуда.
