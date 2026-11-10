import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp, readFile, utimes, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEmail, check, fileNameFor, getUnseenArticles, newestArticleAge, parseArticles, publish,
  pushStatus,
} from '../index.js';

const html = `
<article><div class="BloqueTitular"><h2><a href="/noticia/1/a"> Uno </a></h2></div></article>
<article><div class="BloqueTitular"><h2><a href="/noticia/2/b">Dos</a></h2></div></article>
<article><div class="BloqueTitular"><h2><a href="/noticia/1/a">Uno otra vez</a></h2></div></article>
<article><div class="BloqueTitular"><h2><a>Sin enlace</a></h2></div></article>
<div class="BloqueTitular"><h2><a href="/fuera">Fuera de article</a></h2></div>`;

test('parseArticles extracts, dedupes and absolutizes links', () => {
  assert.deepEqual(parseArticles(html), [
    { title: 'Uno', link: 'https://www.diariodeburgos.es/noticia/1/a' },
    { title: 'Dos', link: 'https://www.diariodeburgos.es/noticia/2/b' },
  ]);
});

test('fileNameFor is a stable sha1 of the link', () => {
  // Must match files already stored in articles/ by the previous `sha1` package
  assert.equal(fileNameFor('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d.json');
});

test('getUnseenArticles skips articles that already have a file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ddb-'));
  const seen = { title: 'a', link: 'https://x/a' };
  const fresh = { title: 'b', link: 'https://x/b' };
  await writeFile(join(dir, fileNameFor(seen.link)), '{}');
  assert.deepEqual(await getUnseenArticles([seen, fresh], dir), [fresh]);
});

test('buildEmail sets subject, body and recipients', () => {
  const { input } = buildEmail({ title: 'T', link: 'L' }, ['a@b.c']);
  assert.deepEqual(input.Destination.ToAddresses, ['a@b.c']);
  assert.equal(input.Message.Subject.Data, '[DiarioDeBurgos - Ribera] T');
  assert.equal(input.Message.Body.Text.Data, 'L');
});

test('publish saves a file only after the email is sent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ddb-'));
  const ok = { title: 'ok', link: 'https://x/ok' };
  const bad = { title: 'bad', link: 'https://x/bad' };
  const ses = {
    send: async (cmd) => {
      if (cmd.input.Message.Subject.Data.endsWith('bad')) throw new Error('SES down');
    },
  };
  await assert.rejects(publish(ses, [ok, bad], dir), /SES down/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, fileNameFor(ok.link)), 'utf8')), ok);
  assert.deepEqual(await getUnseenArticles([ok, bad], dir), [bad]);
});

const page = (...links) => links.map((l) => `<article><div class="BloqueTitular"><h2><a href="${l}">${l}</a></h2></div></article>`).join('');

const stubFetch = (t, body) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return new Response(body);
  });
  return calls;
};

const okSes = { send: async () => {} };

test('check fails when the page has no articles', async (t) => {
  stubFetch(t, '<html>nuevo diseño</html>');
  const dir = await mkdtemp(join(tmpdir(), 'ddb-'));
  await assert.rejects(check(okSes, dir), /0 articles found/);
});

test('check fails when no new article arrived for too long', async (t) => {
  stubFetch(t, page('/noticia/viejo'));
  const dir = await mkdtemp(join(tmpdir(), 'ddb-'));
  const file = join(dir, fileNameFor('https://www.diariodeburgos.es/noticia/viejo'));
  await writeFile(file, '{}');
  const old = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
  await utimes(file, old, old);
  await assert.rejects(check(okSes, dir), /No new articles for 4\.0 days/);
});

test('check publishes new articles and reports a summary', async (t) => {
  stubFetch(t, page('/noticia/a', '/noticia/b'));
  const dir = await mkdtemp(join(tmpdir(), 'ddb-'));
  await writeFile(join(dir, fileNameFor('https://www.diariodeburgos.es/noticia/a')), '{}');
  assert.equal(await check(okSes, dir), '2 articles, 1 new');
});

test('newestArticleAge uses the most recent file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ddb-'));
  await writeFile(join(dir, 'a.json'), '{}');
  await writeFile(join(dir, 'b.json'), '{}');
  await utimes(join(dir, 'a.json'), new Date(1000), new Date(1000));
  await utimes(join(dir, 'b.json'), new Date(5000), new Date(5000));
  assert.equal(await newestArticleAge(dir, 6000), 1000);
});

test('pushStatus overrides status and msg in the Kuma URL', async (t) => {
  const calls = stubFetch(t, 'ok');
  await pushStatus('down', 'algo falló', 'http://kuma/api/push/tok?status=up&msg=OK&ping=');
  assert.deepEqual(calls, ['http://kuma/api/push/tok?status=down&msg=algo+fall%C3%B3&ping=']);
});

test('pushStatus does nothing without a URL and never throws', async (t) => {
  const calls = stubFetch(t, 'ok');
  await pushStatus('up', 'x', undefined);
  assert.equal(calls.length, 0);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  await pushStatus('up', 'x', 'http://kuma/api/push/tok');
});
