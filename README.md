# Smart Nap Timer -- Payment Backend

Node.js/Express backend that handles PayOS payments for Vietnamese users.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| POST | /payments/create | Create PayOS payment link |
| GET | /payments/status/:orderCode | Poll payment status |
| POST | /payments/webhook | PayOS webhook (payment confirmed) |

## Setup

1. Copy `.env.example` to `.env` and fill in your PayOS credentials
2. `npm install`
3. `npm run dev`

## Deploy to Render

1. Push to GitHub
2. Create new Web Service on render.com
3. Connect GitHub repo
4. Set environment variables from `.env.example`
5. Build command: `npm install && npm run build`
6. Start command: `npm start`

## Built with [Orion](https://meetorion.app)
