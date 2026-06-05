# NFT Гарант Бот

Telegram-бот-гарант для безопасных сделок с цифровыми товарами (NFT, скины, аккаунты, Stars, крипта).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — запустить сервер + Telegram бот (порт 5000)
- `pnpm run typecheck` — проверка типов по всем пакетам
- `pnpm run build` — typecheck + сборка всех пакетов
- `pnpm --filter @workspace/db run push` — применить изменения схемы БД (только dev)
- Требуемые env: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Telegram: Telegraf v4
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (ESM bundle)

## Where things live

- `lib/db/src/schema/` — схемы таблиц (users, wallets, deals, wallet_transactions)
- `artifacts/api-server/src/bot/` — весь код Telegram бота
  - `index.ts` — главный файл бота, все хэндлеры
  - `db.ts` — запросы к базе данных
  - `keyboards.ts` — клавиатуры и inline-кнопки
  - `utils.ts` — вспомогательные функции
  - `session.ts` — типы сессии

## Architecture decisions

- Бот запускается вместе с Express-сервером в одном процессе через `bot.launch()` (long polling)
- Сессия пользователя хранится в памяти через telegraf session middleware (шаги создания сделки)
- Telegram ID используется как primary key в таблице users
- Сделки имеют уникальный 8-символьный код (hex), ссылка для приглашения партнёра через `?start=deal_CODE`

## Product

- `/start` — приветствие + главное меню
- **Создать сделку 🤝** — пошаговое создание сделки (роль → описание → сумма → валюта → подтверждение)
- **Кошелек 💼** — балансы в ГРН, РУБ, TON, Звёздах + история транзакций
- **Моя статистика 📈** — количество сделок (всего / завершённых / активных / отменённых)
- **Поддержка 🆘** — контакт поддержки + FAQ

## User preferences

- Общение на русском языке

## Gotchas

- После изменения схемы БД нужно: `pnpm --filter @workspace/db run push`
- При первом запуске таблицы создаются автоматически через drizzle push
- Бот работает через long polling (не webhook) — удобно для dev/Replit
