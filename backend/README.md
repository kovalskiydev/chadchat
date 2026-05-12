# Backend (Go) - Microservices

Сервис разделен на процессы:
- `api-gateway` (`:8080`) — входная точка для фронта + CORS.
- `auth-service` (`:8081`) — anonymous/register/login/upgrade/refresh/logout/me.
- `verification-service` (`:8082`) — pre-registration liveness flow.
- `test-lab-service` (`:8083`) — комнаты и скоринг для test lab.
- `live-chat-service` (`:8084`) — общий чат.
- `duel-service` (`:8085`) — live 1v1 matchmaking и матч-фазы.
- `rating-service` (`:8086`) — rating, rank, leaderboard, rating history.
- `customization-service` (`:8087`) — result sounds и выбор активного победного звука.
- `ml-service` (`:8090`) — Python FastAPI с вашей ML моделью.
- `mysql` (`:3306`) — persistent store.

## Запуск локально

```bash
docker compose up --build
```

Для продового запуска задайте:
- `AUTH_ACCESS_TOKEN_SECRET`
- `AUTH_REFRESH_TOKEN_SECRET`
- `VERIFICATION_INTERNAL_SECRET`
- `MYSQL_DSN`
- `CUSTOMIZATION_INTERNAL_SECRET`
- `ADMIN_API_SECRET`

## Storage

Сейчас для хранения подходит `MySQL`, и он уже подключен как основной persistent store.

В MySQL сохраняются:
- пользователи и refresh-сессии
- рейтинг, peak rating и rating history
- result sounds, user ownership и selected sound settings
- verification sessions и verification tokens
- история общего чата
- test-lab комнаты, сессии и samples

Пока остаются в памяти:
- live subscribers для SSE
- duel matchmaking queue и live match state
- in-memory rate limits

Это сделано специально: долговечные данные уже переживают рестарт, а live-эфемерное состояние пока оставлено простым.

## Rating API

Рейтинг больше не живет в `auth-service`. Его источник истины теперь отдельный `rating-service`.

Эндпоинты через gateway:
- `GET /rating/me`
- `GET /rating/{userID}`
- `GET /leaderboard`
- `GET /stats/me/summary`
- `GET /stats/me/period`
- `GET /stats/me/history`
- `GET /stats/me/recent-form`
- `GET /stats/me/queue-info`
- `GET /matches/me`

`/me`, `login`, `register`, `anonymous`, `upgrade`, `refresh` больше не должны считаться источником рейтинга. Фронт должен получать рейтинг отдельно через `rating-service`.

`rating-service` теперь также хранит историю завершенных `duel` матчей и на её основе отдает статистику и пагинируемый match history.

## Flow верификации до регистрации

1. `POST /verification/start`
2. `POST /verification/submit` -> получить `verification_token`
3. `POST /auth/anonymous` или `POST /auth/register` c `verification_token`
4. `POST /auth/upgrade` не требует повторной верификации, если пользователь уже был создан как `anonymous`.

Через gateway наружу доступны только `POST /verification/start` и `POST /verification/submit`. `POST /verification/consume` теперь внутренний и защищен `VERIFICATION_INTERNAL_SECRET`.

## Test Lab API (через gateway :8080)

Все эндпоинты требуют `Authorization: Bearer <access_token>`.

1. `POST /test-lab/rooms`
- Создает персональную test-lab комнату.
- Ответ: объект `room`.

2. `GET /test-lab/rooms/{roomID}`
- Возвращает комнату и список test-lab сессий.

3. `POST /test-lab/rooms/{roomID}/sessions/start`
- Стартует новую timed-сессию.
- Длительность всегда фиксирована: `10` секунд.

4. `POST /test-lab/rooms/{roomID}/sessions/{sessionID}/scan`
- Принимает кадр лица и возвращает промежуточный результат.
- Body:
```json
{
  "image_base64": "..."
}
```
- В ответе:
  - `last_score` (оценка текущего кадра)
  - `running_average` (средний за все принятые кадры)
  - `seconds_left`
  - `samples_count`
  - `is_finished`
- После завершения времени (например, 10 секунд) возвращается `final_average`.

5. `GET /test-lab/rooms/{roomID}/sessions/{sessionID}`
- Текущее состояние сессии (включая `running_average` / `final_average`).

## ML service

Python API из `ml/api.py` используется как есть:
- `GET /health`
- `POST /predict` с `image_base64`

## Live Chat API (общий чат, через gateway :8080)

Все эндпоинты требуют `Authorization: Bearer <access_token>`.

1. `GET /live-chat/history`
- Возвращает текущую историю общего чата (весь буфер).

2. `POST /live-chat/history`
- Возвращает последние N сообщений из общего чата.
- Body:
```json
{
  "limit": 100
}
```
- Допустимый диапазон: `1..1000`.

3. `POST /live-chat/messages`
- Отправить сообщение в общий чат.
- Body:
```json
{
  "text": "Привет всем"
}
```

4. `GET /live-chat/stream`
- SSE stream реального времени (`text/event-stream`).
- Возвращает события:
  - `joined`
  - `history`
  - `message`
- На `POST /live-chat/messages` действует rate limit.

## Duel 1v1 API (через gateway :8080)

Все эндпоинты требуют `Authorization: Bearer <access_token>`.

1. `POST /duel/queue/join`
- Встать в очередь.
- Если найден соперник, создается матч и вернется `match_id`.

2. `POST /duel/queue/leave`
- Выйти из очереди.

3. `GET /duel/match/current`
- Текущий матч пользователя (если есть).

4. `GET /duel/match/{matchID}`
- Состояние матча.

5. `GET /duel/match/{matchID}/stream`
- SSE-события (`joined`, `match_found`, `result_sounds_updated`, `media_ready_update`, `phase_changed`, `timer`, `score_update`, `finished`).

6. `POST /duel/match/{matchID}/media-ready`
- Вызывается фронтом после того, как удаленная вебка реально поднялась.
- Только когда оба игрока отметились `media-ready`, матч переходит из `awaiting_media` в `pre_start`.

7. `POST /duel/match/{matchID}/signal`
- WebRTC signaling для видео/аудио (offer/answer/ice-candidate).
- Body примеры:
```json
{
  "type": "offer",
  "sdp": "v=0..."
}
```
```json
{
  "type": "ice-candidate",
  "candidate": "candidate:...",
  "sdp_mid": "0",
  "sdp_mline_index": 0
}
```

8. `POST /duel/match/{matchID}/score-frame`
- Body:
```json
{
  "image_base64": "..."
}
```
- Принимается только в фазах `scoring` и `overtime`.
- На `score-frame` действует rate limit примерно `3.5 кадра/сек`.

### Result sounds в дуэли

- В snapshot матча теперь есть `result_sounds`:
```json
{
  "result_sounds": {
    "u_1": {
      "id": "sigma_bell",
      "title": "Sigma Bell",
      "audio_url": "https://cdn.example.com/sounds/sigma_bell.mp3"
    },
    "u_2": {
      "id": "default_win",
      "title": "Default Win",
      "audio_url": "https://cdn.example.com/sounds/default_win.mp3"
    }
  }
}
```
- Фронт должен preload-ить оба звука сразу после `joined` / `match_found` / `result_sounds_updated`.
- В `finished` приходит `winner_result_sound_id` и `winner_result_sound`, чтобы обе стороны синхронно проиграли звук победителя.

### Фазы матча
- `awaiting_media` — матч найден, но старт не идет, пока оба клиента не подтвердят поднятое медиа.
- `pre_start` — 10 сек до старта (видео/голос).
- `scoring` — 10 сек оценка.
- `overtime` — 5 сек, если разница средних < `0.15`.
- `result` — вычисление результата.
- `post_chat` — 10 сек после результата.
- `finished` — матч завершен.

## Customization API (через gateway :8080)

Все эндпоинты требуют `Authorization: Bearer <access_token>`.

1. `GET /result-sounds`
- Возвращает все активные result sounds с полями `owned`, `selected`, `is_default`.

2. `POST /result-sounds/select`
- Body:
```json
{
  "sound_id": "default_win"
}
```
- Сервер разрешит выбрать только дефолтный или уже открытый пользователю звук.

## Customization Admin API (через gateway :8080)

Эндпоинты администрирования защищены заголовком:
- `X-Admin-Secret: <ADMIN_API_SECRET>`

1. `POST /admin/result-sounds`
- Создать или обновить звук.
- Body:
```json
{
  "id": "sigma_bell",
  "title": "Sigma Bell",
  "audio_url": "https://cdn.example.com/sounds/sigma_bell.mp3",
  "is_default": false,
  "is_active": true
}
```

2. `POST /admin/result-sounds/grant`
- Выдать звук пользователю.
- Body:
```json
{
  "user_id": "u_1",
  "sound_id": "sigma_bell",
  "source": "admin"
}
```

## Security Notes

- `auth-service` использует `JWT` для access/refresh токенов и `bcrypt` для хранения паролей.
- На критичных endpoints включен in-memory rate limit: `auth`, `verification`, `live-chat/messages`, `test-lab scan`, `duel score-frame`.
- Для `test-lab scan` и `duel score-frame` лимит сейчас настроен примерно на `3.5 кадра/сек`.
