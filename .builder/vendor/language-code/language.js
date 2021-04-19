const https = require('https');
const { writeFileSync } = require('fs');
const yaml = require('yaml');

const LINGUIST_LANGUAGE_YAML_URL = 'https://github.com/github/linguist/raw/master/lib/linguist/languages.yml';

const LANGUAGE_CODE_DATA_DST = 'language-code.json';


function request(url, cb) {
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; mk-language-code/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Gecko/20100101 Firefox/78.0 Chrome/55.0.2883.75 Safari/537.36 Maxthon/5.1.3.2000'
    }
  };

  https.get(url, options, (response) => {
    switch (response.statusCode) {
      case 301:
      case 302:
      case 304:
      case 307:
      case 308:
        return request(response.headers.location, cb);
      break;

      case 204: return console.error('No Content', response.statusCode); break;
      case 400: return console.error('Bad Request', response.statusCode); break;
      case 401: return console.error('Unauthorized', response.statusCode); break;
      case 403: return console.error('Forbidden', response.statusCode); break;
      case 408: return console.error('Request Timeout', response.statusCode); break;
      case 410: return console.error('Gone', response.statusCode); break;
      case 429: return console.error('Too Many Requests', response.statusCode); break;
      case 500: return console.error('Internal Server Error', response.statusCode); break;
      case 502: return console.error('Bad Gateway', response.statusCode); break;
      case 503: return console.error('Service Unavailable', response.statusCode); break;
      case 504: return console.error('Gateway Timeout', response.statusCode); break;

      case 200:
      case 304:
        console.log('OK', response.statusCode);
      break;

      default:
        return console.error('Not a valid response', response.statusCode);
    }

    var data = '';

    response.on('data', (chunk) => {
      data += chunk;
    });
    response.on('end', () => {
      if (data.length === 0) {
        return console.error('Empty data.');
      }

      cb(data);
    });
  });
}

function beautify(content) {
  return content.replace(/:/g, ': ').replace(/([^\{\},\n]+)/g, '\n  $1').replace('\}', '\n}\n');
}


request(LINGUIST_LANGUAGE_YAML_URL, (data) => {
  var content = {};

  try {
    data = yaml.parse(data);

    for (var lang in data) {
      content[lang] = 'color' in data[lang] ? data[lang].color.toLowerCase() : false;
    }

    writeFileSync(LANGUAGE_CODE_DATA_DST, beautify(JSON.stringify(content)));
  } catch (err) {
    console.log('Error', err);
  }
});
