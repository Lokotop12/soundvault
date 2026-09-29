# SoundVault

Локальный веб-клиент SoundCloud, работающий без VPN. Браузер общается только с `localhost` — весь трафик к SoundCloud идёт через локальный Node-сервер, который сам выбирает рабочий канал.

## Запуск

```bash
cd ~/soundvault
node server.js
```

Откройте http://localhost:8787

## Вход в аккаунт

Официальная регистрация API-приложений у SoundCloud закрыта, поэтому вход — через токен вашего аккаунта (один раз):

1. Откройте https://soundcloud.com и залогиньтесь.
2. Нажмите F12 → вкладка **Application** (Хранилище) → **Cookies** → `https://soundcloud.com`.
3. Скопируйте значение куки `oauth_token`.
4. Вставьте его на экране входа SoundVault.

Токен сохраняется локально в `config.json`. Без токена работает анонимный режим (поиск и прослушивание).

## Как это работает

- `server.js` — Node-сервер на `127.0.0.1:8787`, без сборки, одна зависимость (`undici`).
- При старте выбирается канал к SoundCloud: **direct → локальный прокси 127.0.0.1:10809 → релей** (`SC_RELAY_URL`).
- `client_id` для API добывается автоматически из JS-бандлов soundcloud.com, при 401 перескрапивается.
- Аудио и картинки проксируются через `/media` (с поддержкой Range — перемотка работает), HLS-плейлисты переписываются через `/hls`.

## Релей через Cloudflare Worker (опционально)

Если direct заблокирован и локального прокси нет — задеплойте `worker/worker.js` как Cloudflare Worker (бесплатный тариф) и запускайте:

```bash
SC_RELAY_URL="https://your-worker.workers.dev" node server.js
```

## Горячие клавиши

- `Пробел` — play/pause
- `←` / `→` — перемотка 5 сек
- `N` / `P` — следующий / предыдущий трек

## Сборка Windows-инсталлера

```bash
# нужен wine (портативная сборка Kron4ek подходит) и libc6:i386
PATH=/path/to/wine/bin:$PATH npx electron-builder --win nsis
# результат: dist/SoundVault Setup <версия>.exe
```
