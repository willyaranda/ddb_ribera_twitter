# ddb_ribera_twitter

Checks the [Diario de Burgos Ribera section](https://www.diariodeburgos.es/seccion/Ribera) every 10 minutes and emails each new article (via AWS SES) to a fixed list of recipients. Seen articles are stored as `articles/<sha1(link)>.json`.

## Run

Requires Node 26 via [nvm](https://github.com/nvm-sh/nvm) (`nvm install`, reads `.nvmrc`); `start.sh` runs `nvm use` itself.

```sh
npm ci
cp start.sh.example start.sh   # fill in AWS credentials
./start.sh
```

Environment variables:

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: SES credentials (eu-west-1).
- `EMAIL_TO`: comma-separated recipients, overrides the default list.
- `KUMA_PUSH_URL`: Uptime Kuma push monitor URL. After each check it pushes UP, or DOWN with the reason (check failed, 0 articles found, no new articles for `STALE_DAYS`). If pushes stop, Kuma marks it DOWN by itself.
- `STALE_DAYS`: days without new articles before reporting DOWN (default 3).
- `ARTICLES_DIR`: where seen articles are stored (default `articles`).

## Test

```sh
npm run lint
npm test
```
