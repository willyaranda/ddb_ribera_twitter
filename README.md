# ddb_ribera_twitter

Checks the [Diario de Burgos Ribera section](https://www.diariodeburgos.es/seccion/Ribera) and emails each new article (via AWS SES) to `EMAIL_TO`.

It runs every 30 minutes on GitHub Actions (`.github/workflows/check.yml`). Seen articles are committed as `<sha1(link)>.json` to the `articles` branch, which is the bot's state (`main` only holds code).

## Configuration

- AWS: the workflow assumes the IAM role `ddb-ribera-github-actions` through GitHub OIDC (no stored keys). Its only permission is `ses:SendEmail` from `info@sentiraranda.es`.
- `EMAIL_TO` (repository variable): comma-separated recipients.
- `KUMA_PUSH_URL` (repository secret): Uptime Kuma push monitor. Each run pushes UP, or DOWN with the reason (check failed, 0 articles found, no new articles for `STALE_DAYS`). If runs stop, Kuma marks it DOWN by itself.
- `STALE_DAYS`: days without new articles before reporting DOWN (default 3).
- `ARTICLES_DIR`: where seen articles are stored (default `articles`).

## Run locally

Requires Node 26 (`nvm use`). One run per invocation:

```sh
npm ci
EMAIL_TO=you@example.com AWS_PROFILE=... npm start
```

## Test

```sh
npm run lint
npm test
```
