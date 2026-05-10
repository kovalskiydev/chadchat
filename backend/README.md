# Backend (Go) - Microservices

Сервис разделен на процессы:
- `api-gateway` (`:8080`) — входная точка для фронта + CORS.
- `auth-service` (`:8081`) — anonymous/register/login/upgrade/refresh/logout/me.
- `verification-service` (`:8082`) — pre-registration liveness flow.
- `test-lab-service` (`:8083`) — комнаты и скоринг для test lab.
- `ml-service` (`:8090`) — Python FastAPI с вашей ML моделью.

## Запуск локально

```bash
docker compose up --build
```

## Flow верификации до регистрации

1. `POST /verification/start`
2. `POST /verification/submit` -> получить `verification_token`
3. `POST /auth/anonymous` или `POST /auth/register` c `verification_token`
4. `POST /auth/upgrade` не требует повторной верификации, если пользователь уже был создан как `anonymous`.

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
- SSE-события (`match_found`, `phase_changed`, `timer`, `score_update`, `finished`).

6. `POST /duel/match/{matchID}/signal`
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

7. `POST /duel/match/{matchID}/score-frame`
- Body:
```json
{
  "image_base64": "..."
}
```
- Принимается только в фазах `scoring` и `overtime`.

### Фазы матча
- `pre_start` — 10 сек до старта (видео/голос).
- `scoring` — 10 сек оценка.
- `overtime` — 5 сек, если разница средних < `0.15`.
- `result` — вычисление результата.
- `post_chat` — 10 сек после результата.
- `finished` — матч завершен.
