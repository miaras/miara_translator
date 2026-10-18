# Shiroko Translator

## Run locally

Use Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. The server serves the built site and the account API. `npm run build && npm start` runs the same setup for a deployment. Set `HOST` and `PORT` if the server should listen somewhere other than `127.0.0.1:3000`; use HTTPS when exposing it publicly.

Set `OPENAI_API_KEY` in `.env` (or in the server environment) before starting the server:

```sh
OPENAI_API_KEY=your_api_key
```

Translation and sentence regeneration use `gpt-6.1-sol` through the server. The key is never included in the browser build. The editor's price display is a base estimate from source text length; prompt context, reasoning, and output length affect the actual API charge.

Accounts and saved translations live in `data/store.json` by default; this directory is ignored by Git. Back it up to keep user work. Set `SHIROKO_DATA_FILE` to use another persistent file. Each saved translation includes the original text, target language, style instructions, paragraph boundaries, and editable aligned sentence pairs.

For frontend hot reload, run `npm run dev:client` alongside `npm start`. Vite proxies `/api` to the server on port 3000.

Run `npm test` for the account and saved-translation integration test.
