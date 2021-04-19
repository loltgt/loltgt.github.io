/*!
 * entanglement-gh
 *
 * @version 0.0.1
 * @copyright Copyright (C) Leonardo Laureti
 * @license MIT License
 */

const { readFileSync, watch: fsWatch } = require('fs');
const { readFile, writeFile } = require('fs/promises');
const httpServer = require('http-server');
const path = require('path');
const glob = require('glob');
// const https = require('http'); //TODO https
const https = require('https');
const lodash = require('lodash');
const CleanCSS = require('clean-css');
const { minify } = require('terser');



function config(file) {
  try {
    var data = readFileSync(file);

    if (! (typeof data == 'object' && data instanceof Buffer)) {
      throw new Error('Bad configuration file.');
    }

    data = data.toString();
    data = data.replace(/\/\/([^\r\n]+)|(\/[\*]+)(=?[\w\W]+?)(\*\/)/g, '');
    data = data.replace(/([\s]+)([\s]+)|[\r\n\t]+/g, '');
    data = data.replace(/\,(=?(?=\}))/g, '');
    data = JSON.parse(data);

    return data;
  } catch (err) {
    throw err;
  }
}


class request {

  constructor(url, endpoint, options = {}) {
    const request_options = {
      headers: {
        'User-Agent': 'entanglement-gh/0.0.1'
      }
    };
    var request_filter = this.filters(url, request_options, endpoint, options);

    this.request_url = request_filter.url;
    this.request_options = request_filter.options;

    return this.routine(endpoint, options);
  }

  routine(endpoint, options) {
    return new Promise((resolve, reject) => {
      this.request(this.request_url, endpoint, resolve, reject);
    });
  }

  filters(request_url, request_options, endpoint, options) {
    var qs = [];

    if (endpoint === 'repos') {
      if (options.sort && typeof options.sort == 'string') qs.push('sort=' + options.sort);
      if (options.order && typeof options.order == 'string') qs.push('direction=' + options.order);
      //TODO FIX include                    .sort
      // if (options.limit && typeof options.sort == 'number') qs.push('per_page=' + options.limit);
    } else if (endpoint === 'gists') {
      if (options.since && typeof options.since == 'string') qs.push('since=' + options.since);
    }

    if (qs.length) request_url += '?' + qs.join('&');

    return { url: request_url, options: request_options };
  }

  request(url, endpoint, resolve, reject) {
    https.get(url, this.request_options, (response) => {
      this.process(response, endpoint, resolve, reject);
    }).on('error', (err) => {
      reject({ err });
    });
  }

  process(response, endpoint, resolve, reject) {
    switch (response.statusCode) {
      case 301:
      case 302:
      case 304:
      case 307:
      case 308:
        var url = response.headers.location;

        if (url) this.request(url, endpoint, resolve, reject);
        else reject({ err: 'Error:', status: response.statusCode, msg: 'Missing URL.' });
      break;

      case 204:
      case 400:
      case 401:
      case 403:
      case 408:
      case 410:
      case 429:
      case 500:
      case 502:
      case 503:
      case 504:
        this.parser(response).then((data) => {
          var msg = 'message' in data ? data.message : '';

          reject({ err: 'Error:', status: response.statusCode, msg });
        }).catch(err => {
          reject({ err, status: response.statusCode });
        });
      break;

      case 200:
      case 304:
        this.complete(response, endpoint, resolve, reject);
      break;

      default:
        reject({ err: 'Error:', status: response.statusCode, msg: 'Not a valid response.' });
    }
  }

  parser(response) {
    return new Promise((resolve, reject) => {
      var data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          data = JSON.parse(data);

          if (data.length === 0) {
            throw 'Empty data.';
          }

          resolve(data);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  complete(response, endpoint, resolve, reject) {
    this.parser(response).then((data) => {
      var partial = {};
      partial[endpoint] = data;

      resolve(partial);
    }).catch(err => {
      reject({ err });
    });
  }

}


function filtering(partial, endpoint) {
  let _partial = partial[endpoint.name];

  if (endpoint.options.include && typeof endpoint.options.include == 'object') {
    var include = endpoint.options.include;
    _partial = lodash.filter(_partial, (o) => (include.indexOf(o.name) != -1));
    //TODO FIX ordered
  }
  if (endpoint.options.exclude && typeof endpoint.options.exclude == 'object') {
    var exclude = endpoint.options.exclude;
    _partial = lodash.reject(_partial, (o) => (exclude.indexOf(o.name) != -1));
  }
  if (endpoint.name === 'gists') {
    var sort, order;

    if (endpoint.options.sort && typeof endpoint.options.sort == 'string') {
      sort = endpoint.options.sort + '_at';
    }
    if (endpoint.options.order && typeof endpoint.options.order == 'string') {
      order = endpoint.options.order;
    }

    _partial = lodash.orderBy(_partial, [sort, order]);
  }
  if (endpoint.options.limit && typeof endpoint.options.limit == 'number') {
    var limit = endpoint.options.limit;

    if (_partial.length !== endpoint.options.limit) {
      _partial = lodash.take(_partial, limit);
    }
  }

  partial[endpoint.name] = _partial;

  return partial;
}


class layout {

  constructor() {
    this.make.apply(this, arguments);
  }

  async make(tplBase, tpls, cardTpls, outFile, tplData, clientTpls) {
    this.templateBase = tplBase;
    this.outputFile = outFile;

    var cards = {};
    var parts = [];
    var templates = [];

    for (var cardTplName of cardTpls) {
      var template = await this.template(cardTplName);

      cards[cardTplName] = template;
    }
    for (var tplName of tpls) {
      parts.push(await this.compile(tplName, { ...tplData, cards }));
    }
    for (var clientTplName of clientTpls) {
      var template = await this.template(clientTplName);

      templates.push({ name: clientTplName, source: template });
    }

    var output = await this.compile('layout', { ...tplData, page: parts.join(''), templates });
    output = output.replace(/^\n|\r$/gm, '');

    this.write(output);
  }

  template(tplName) {
    try {
      const tplFile = path.format({ dir: this.templateBase, name: tplName, ext: '.jst' });

      return readFile(tplFile);
    } catch (err) {
      throw err;
    }
  }

  async compile(tplName, tplData) {
    try {
      var data = await this.template(tplName);
      var compiled = lodash.template(data);

      return compiled(tplData);
    } catch (err) {
      throw err;
    }
  }

  async write(output) {
    try {
      writeFile(this.outputFile, output);
    } catch (err) {
      throw err;
    }
  }

}


class assets {

  static async styles(files, dst, options) {
    try {
      var output = new CleanCSS(options).minify(files);
      writeFile(dst, output.styles);
    } catch (err) {
      throw err;
    }
  }

  static async scripts(files, dst, options) {
    try {
      var input = await Promise.all(files.map((file) => readFile(file)));
      var output = await minify(input.map((data) => data.toString()), options);
      writeFile(dst, output.code);
    } catch (err) {
      throw err;
    }
  }

}


const DEFAULT_CONFIG = {
  "theme": "light",
  "layout": ["profile", "repos", "topics"],
  "profile": {
    "realname": false,
    "location": false,
    "socials": false
  },
  "stylesheets": ["./src/style.css", "./vendor/icons/style.css", "./custom.css"],
  "scripts": ["./src/script.js", "./custom.js"],
  "data_folder": "./data",
  "template_folder": "./template",
  "src_folder": "./src",
  "output_folder": "./out",
  "assets_folder": "./out/assets",
  "assets_stylesheet": "styles.css",
  "assets_script": "scripts.js",
  "serve": "0.0.0.0:8080"
};

const CWD = process.cwd();

const configFile = path.format({ dir: CWD, base: 'config.json' });

const CONFIG = lodash.defaults(config(configFile), DEFAULT_CONFIG);

const DATA_FOLDER = path.relative(CWD, CONFIG.data_folder);
const TEMPLATE_FOLDER = path.relative(CWD, CONFIG.template_folder);
const SRC_FOLDER = path.relative(CWD, CONFIG.src_folder);
const OUTPUT_FOLDER = path.relative(CWD, CONFIG.output_folder);
const ASSETS_FOLDER = path.relative(CWD, CONFIG.assets_folder);

const languageCodeFile = path.format({ dir: DATA_FOLDER, base: 'language-code.json' });
const socialsFile = path.format({ dir: DATA_FOLDER, base: 'socials.json' });

const LANGUAGE_CODE = config(languageCodeFile);
const SOCIALS = config(socialsFile);

const REST_API = 'https://api.github.com/users/%username%';

var cached_data;



function log() {
  const colors = {
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
  };
  var deep = arguments[1] ? arguments[1] : 0;
  var color = arguments[2] && colors[arguments[2]] ? colors[arguments[2]] : false;
  var msgs = [ ''.padStart(deep, '  '), arguments[0], ...Object.values(arguments).slice(3) ];

  if (! deep || deep === 2) {
    msgs.splice(0, 0, '\n');
    msgs.push('\n');
  }
  if (deep === 1 || deep === 3 || color) {
    msgs.splice(0, 0, color ? color : colors.green);
    msgs.push('\x1b[0m');
  }

  console.log(...msgs);
}


function scripts(depth = 1) {
  const assetFile = path.format({ dir: ASSETS_FOLDER, base: CONFIG.assets_script });

  assets.scripts(CONFIG.scripts, assetFile);

  log('scripts', depth);
}


function styles(depth = 1) {
  const assetFile = path.format({ dir: ASSETS_FOLDER, base: CONFIG.assets_stylesheet });

  assets.styles(CONFIG.stylesheets, assetFile);

  log('styles', depth);
}


function html(depth = 1) {
  const outputFile = path.format({ dir: OUTPUT_FOLDER, base: 'index.html' });
  const assetStylesheetFile = path.relative(OUTPUT_FOLDER, path.format({ dir: ASSETS_FOLDER, base: CONFIG.assets_stylesheet }));
  const assetScriptFile = path.relative(OUTPUT_FOLDER, path.format({ dir: ASSETS_FOLDER, base: CONFIG.assets_script }));

  const tpls = CONFIG.layout;
  const cardTpls = ['repo', 'gist', 'topic'];

  var tplData = {
    theme: CONFIG.theme,
    assets: {
      stylesheet: assetStylesheetFile,
      script: assetScriptFile
    },
    languageCode: LANGUAGE_CODE
  };

  var clientTpls = [];

  //TODO FIX
  if ('repos' in CONFIG && typeof CONFIG.repos == 'object' && CONFIG.repos.clientSide) {
    clientTpls.push('repo');
  }
  if ('gists' in CONFIG && typeof CONFIG.gists == 'object' && CONFIG.gists.clientSide) {
    clientTpls.push('gist');
  }

  const meta = 'meta' in CONFIG && CONFIG.meta && typeof CONFIG.meta == 'object' ? CONFIG.meta : {};
  //TODO FIX
  const profile = lodash.defaults({}, CONFIG.profile, { realname: false, location: false, socials: false });
  const socials = 'socials' in CONFIG && CONFIG.socials && typeof CONFIG.socials == 'object' ? CONFIG.socials : {};
  const topics = 'topics' in CONFIG && CONFIG.topics && typeof CONFIG.topics == 'object' ? CONFIG.topics : {};


  var socials_data = [];

  //TODO FIX iterable
  for (var social_slug in socials) {
    var social_url = socials[social_slug];

    if (social_slug in SOCIALS) socials_data.push({ name: SOCIALS[social_slug].name, icon: 'icon-' + SOCIALS[social_slug].icon, url: social_url });
    else socials_data.push({ name: social_slug, icon: 'icon-' + social_slug, url: social_url });
  }

  var topics_data = [];

  //TODO FIX iterable
  for (var topic_slug of topics) {
    topic_slug = topic_slug.trim().toLowerCase();

    var topic_url = 'https://github.com/topics/' + topic_slug.toLowerCase().trim();

    topics_data.push({ name: topic_slug, url: topic_url });
  }

  var body_classname = [ 'site', CONFIG.theme, 'sections-' + (CONFIG.layout.length - 1) ];


  fetch().then(function(data) {
    tplData.meta = {
      title: meta && 'title' in meta && !! meta.title ? meta.title : data.user.login,
      description: meta && 'description' in meta && !! meta.description ? meta.description : '',
      image: data.user.avatar_url
    };
    tplData.profile = profile;
    tplData.socials = socials;

    tplData.user = data.user;
    tplData.repos = 'repos' in data ? data.repos : [];
    tplData.gists = 'gists' in data ? data.gists : [];
    tplData.topics = topics_data;
    tplData.socials = socials_data;
    tplData.username = data.user.login;
    tplData.bodyClassname = body_classname.join(' ');

    new layout(TEMPLATE_FOLDER, tpls, cardTpls, outputFile, tplData, clientTpls);
  });

  log('html', depth);
}


function fetch() {
  if (cached_data) {
    return Promise.resolve(cached_data);
  }

  log('fetching from github ...', 0, 'cyan');

  var url, endpoints = [];
  var data = cached_data = {};

  const _resolved = () => {
    log('fetched', 0, 'cyan', 'ok');
    return true;
  }
  const _rejected = (reason) => {
    log('error requesting', 0, false, reason.err, reason.status ? reason.status : '', reason.msg ? reason.msg : '');
    return true;
  }


  const defaults_repos = defaults_gists = { clientSide: false, limit: 6, sort: 'updated' };

  //TODO FIX
  if (! ('repos' in CONFIG && typeof CONFIG.repos == 'object' && CONFIG.repos.clientSide)) {
    endpoints.push({ name: 'repos', options: lodash.defaults({}, CONFIG.repos, defaults_repos) });
  }
  // if (! ('gists' in CONFIG && typeof CONFIG.gists == 'object' && CONFIG.gists.clientSide)) {
  //   endpoints.push({ name: 'gists', options: lodash.defaults({}, CONFIG.gists, defaults_gists) });
  // }


  return new Promise((resolve, reject) => {
    url = REST_API.replace('%username%', CONFIG.username);
    // url = 'http://0.0.0.0:8000/users/%username%';
    // const tmp_url = url;

    new request(url, 'user').then((initial) => {
      Object.assign(data, initial);

      if (endpoints.length) {
        Promise.all(endpoints.map((endpoint) => {
          //TODO FIX
          url = initial.user[endpoint.name + '_url'].replace(/\{.+\}/, '');
          // url = tmp_url + '/' + endpoint.name;

          return new request(url, endpoint.name, endpoint.options);
        })).then((partials) => {
          partials.forEach(function(partial) {
            var endpoint_name = Object.keys(partial)[0];
            var endpoint_index = lodash.findIndex(endpoints, { name: endpoint_name });
            var endpoint = endpoints[endpoint_index];

            Object.assign(data, filtering(partial, endpoint));
          });

          _resolved() && resolve(data);
        }, reason => {
          _rejected(reason) && reject(reason);
        });
      } else {
        _resolved() && resolve(data);
      }
    }).catch(reason => {
      _rejected(reason) && reject(reason);
    });
  });
}


function watch(type) {
  log('watching ...');

  const typext = { js: 'js', css: 'css', jst: 'html' };

  var pattern = '{' + SRC_FOLDER + '/*.{js,css},' + TEMPLATE_FOLDER + '/*.jst}';

  switch (type) {
    case 'js': pattern = SRC_FOLDER + '/*.js'; break;
    case 'css': pattern = SRC_FOLDER + '/*.css'; break;
    case 'html': pattern = TEMPLATE_FOLDER + '/*.jst'; break;
  }

  glob(pattern, (err, files) => {
    if (err) throw err;

    for (var file of files) {
      fsWatch(file, (eventType, filename) => {
        if (eventType != 'change') return;

        const ftype = filename.match(/\.(js|css|jst)$/);

        if (ftype) build(typext[ftype[1]], 2);
      });
    }
  });
}


function build(type, depth) {
  log('building ...', depth);

  if (depth) depth++;

  switch (type) {
    case 'js': scripts(depth); break;
    case 'css': styles(depth); break;
    case 'html': html(depth); break;
    default: scripts(depth) || styles(depth) || html(depth);
  }
}


function serve() {
  var address = CONFIG.serve.match(/([^:]+):([0-9]+)/);

  if (! address) throw new TypeError('Bad address in "serve" configuration parameter.');

  var server = httpServer.createServer({ root: OUTPUT_FOLDER });

  server.listen(address[2], address[1]);

  log('serving at ' + address[0] + ' ...');
}


function router() {
  const argv = process.argv;
  var arg_type = argv[2] == 'watch' && argv[3] ? argv[3] : argv[2] != 'watch' ? argv[2] : null;
  var arg_watch = argv[2] == 'watch' ? true : false;

  build(arg_type);

  if (arg_watch) watch(arg_type);

  serve();
}


router();


module.exports = {
  default: router,
  config,
  request,
  filtering,
  layout,
  assets,
  log,
  scripts,
  styles,
  html,
  fetch,
  watch,
  build,
  serve,
  router
};
