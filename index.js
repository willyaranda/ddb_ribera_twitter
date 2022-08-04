const cheerio = require('cheerio');
const bent = require('bent');
const http = require('http');

const PORT = process.env.PORT || 5000;
const LOCALHOST = 'localhost';

const HOST = 'https://www.diariodeburgos.es';

const getArticles = async () => {
  console.log('Getting articles...');
  const request = bent(`${HOST}/seccion/Ribera`, 'GET', 'string', 200);
  const response = await request();
  const $ = cheerio.load(response);
  const articles = $('article .BloqueTitular h2 a');
  const rv = [];
  for (const article of articles) {
    const articulo = $(article);
    const link = `${HOST}${articulo.attr('href')}`;
    const title = articulo.text();
    rv.push({
      title,
      link,
    });
  }
  return rv;
};

const getUnpublished = async (articles) => {
  console.log('Getting unpublished articles...');
  return [];
};

const publish = async (articles) => {
  console.log('Publishing articles...');
  return true;
};

const doIt = async () => {
  console.log('Starting...');
  const articles = await getArticles();
  console.log(articles);
  const unpublished = await getUnpublished(articles);
  console.log(unpublished);
  const publishArticles = await publish(unpublished);
  console.log(publishArticles);
  console.log('Done...');
};

const requestListener = async (req, res) => {
  try {
    await doIt();
    res.writeHead(200);
    res.end('Done');
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end(error.message);
  }
};

const server = http.createServer(requestListener);
server.listen(PORT, LOCALHOST, async () => {
  console.log(`Server is running on http://${LOCALHOST}:${PORT}`);
  await doIt();
});
