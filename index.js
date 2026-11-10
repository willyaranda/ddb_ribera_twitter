import { createHash } from 'node:crypto';
import {
  access, mkdir, readdir, stat, writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { load } from 'cheerio';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes
const DAY = 24 * 60 * 60 * 1000;
const HOST = 'https://www.diariodeburgos.es';
const ARTICLES_DIR = process.env.ARTICLES_DIR ?? 'articles';
const KUMA_PUSH_URL = process.env.KUMA_PUSH_URL;
const STALE_DAYS = Number(process.env.STALE_DAYS ?? 3);
const FROM_ADDRESS = 'info@sentiraranda.es';
const TO_ADDRESSES = process.env.EMAIL_TO?.split(',').map((s) => s.trim()) ?? [
  'leticia.nunez.nunez@gmail.com',
  'guillermo@sentiraranda.es',
  'equiporedes@sentiraranda.es',
];

export const fileNameFor = (link) => `${createHash('sha1').update(link).digest('hex')}.json`;

export const parseArticles = (html) => {
  const $ = load(html);
  const seen = new Map();
  for (const el of $('article .BloqueTitular h2 a')) {
    const a = $(el);
    const href = a.attr('href');
    if (!href) continue;
    const link = new URL(href, HOST).href;
    // The same article can appear in several blocks of the page
    if (!seen.has(link)) seen.set(link, { title: a.text().trim(), link });
  }
  return [...seen.values()];
};

export const getArticles = async () => {
  const res = await fetch(`${HOST}/seccion/Ribera`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET /seccion/Ribera failed: ${res.status}`);
  return parseArticles(await res.text());
};

const exists = (path) => access(path).then(() => true, () => false);

export const getUnseenArticles = async (articles, dir = ARTICLES_DIR) => {
  const flags = await Promise.all(articles.map((a) => exists(join(dir, fileNameFor(a.link)))));
  return articles.filter((_, i) => !flags[i]);
};

export const buildEmail = ({ title, link }, to = TO_ADDRESSES) => new SendEmailCommand({
  Destination: { ToAddresses: to },
  Message: {
    Body: { Text: { Charset: 'UTF-8', Data: link } },
    Subject: { Charset: 'UTF-8', Data: `[DiarioDeBurgos - Ribera] ${title}` },
  },
  Source: FROM_ADDRESS,
});

// Sequential so SES rate limits are respected; the file is written only after
// the email succeeds, so a failed send is retried on the next check.
export const publish = async (ses, articles, dir = ARTICLES_DIR) => {
  for (const article of articles) {
    await ses.send(buildEmail(article));
    await writeFile(join(dir, fileNameFor(article.link)), JSON.stringify(article, null, 2));
    console.log(`Sent: ${article.title}`);
  }
};

// Milliseconds since the newest stored article was saved
export const newestArticleAge = async (dir = ARTICLES_DIR, now = Date.now()) => {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
  const mtimes = await Promise.all(names.map(async (n) => (await stat(join(dir, n))).mtimeMs));
  return now - Math.max(...mtimes); // Infinity when there are no articles yet
};

// Throws when something looks wrong, so the caller can report it as DOWN
export const check = async (ses, dir = ARTICLES_DIR) => {
  const articles = await getArticles();
  if (!articles.length) throw new Error('0 articles found: has the page layout changed?');
  const unseen = await getUnseenArticles(articles, dir);
  await publish(ses, unseen, dir);
  const days = (await newestArticleAge(dir)) / DAY;
  if (days > STALE_DAYS) throw new Error(`No new articles for ${days.toFixed(1)} days`);
  return `${articles.length} articles, ${unseen.length} new`;
};

// Uptime Kuma push monitor: it also goes DOWN by itself if pushes stop arriving
export const pushStatus = async (status, msg, url = KUMA_PUSH_URL) => {
  if (!url) return;
  const target = new URL(url);
  target.searchParams.set('status', status);
  target.searchParams.set('msg', msg);
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) console.error(`Kuma push rejected: ${res.status}`);
  } catch (err) {
    console.error('Kuma push failed:', err.message);
  }
};

const main = async () => {
  await mkdir(ARTICLES_DIR, { recursive: true });
  const ses = new SESClient({ region: 'eu-west-1' });
  // A loop instead of setInterval so a slow check never overlaps the next one
  for (;;) {
    try {
      const msg = await check(ses);
      console.log(msg);
      await pushStatus('up', msg);
    } catch (err) {
      console.error('Check failed:', err);
      await pushStatus('down', err.message);
    }
    await sleep(CHECK_INTERVAL);
  }
};

if (import.meta.main) await main();
