# Shiroko Translator

## Run locally

Use Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. The server serves the built site and the account API. `npm run build && npm start` runs the same setup for a deployment. Set `HOST` and `PORT` if the server should listen somewhere other than `127.0.0.1:3000`; use HTTPS when exposing it publicly.

Set `VITE_GEMINI_API_KEY` in `.env` before building to enable translation. This is an existing client-side key integration, so use a key restricted to the intended site and API.

Accounts and saved translations live in `data/store.json` by default; this directory is ignored by Git. Back it up to keep user work. Set `SHIROKO_DATA_FILE` to use another persistent file. Each saved translation includes the original text, target language, style instructions, paragraph boundaries, and editable aligned sentence pairs.

For frontend hot reload, run `npm run dev:client` alongside `npm start`. Vite proxies `/api` to the server on port 3000.

Run `npm test` for the account and saved-translation integration test.
