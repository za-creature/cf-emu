# cf-emu
A local emulator for [cloudflare workers](https://www.cloudflare.com/products/cloudflare-workers/)

[![tests](https://github.com/za-creature/cf-emu/workflows/tests/badge.svg?branch=master&event=push)](https://github.com/za-creature/cf-emu/actions?query=workflow%3Atests+branch%3Amaster)
[![coverage](https://github.com/za-creature/cf-emu/workflows/coverage/badge.svg?branch=master&event=push)](https://za-creature.github.io/cf-emu)

## Installation
```sh
npm install --save-dev cf-emu
```

## Known differences
* `eval()` and `new Function()` are allowed
* `Date.now()` is not throttled
* `setTimeout()` & co are supported regardless of context
* `TextDecoder` supports `utf-8`, `utf-16le` and `latin1`, cloudflare only
  advertises `utf-8`
* `fetch()` is probably less restricted than cloudflare, though not completely
  spec compliant [more info](https://github.com/node-fetch/node-fetch/blob/master/docs/v3-LIMITS.md)
* the `URL` class is following
  [the spec](https://nodejs.org/api/url.html#url_the_whatwg_url_api), it's
  unclear what [cloudflare implements](https://developers.cloudflare.com/workers/reference/apis/standard) though I didn't notice any differences
* cloudflare headers are added, though the `CF-IPCountry` is always hardcoded
  and `CF-Ray` ends with `-DEV`
* [streams](https://developers.cloudflare.com/workers/reference/apis/streams/)
  are not implemented
* [kv bindings](https://developers.cloudflare.com/workers/reference/apis/kv/)
  are not implemented
* [secret bindings](https://developers.cloudflare.com/workers/reference/apis/environment-variables/)
  are not persisted across deployments
* [`crypto`](https://developers.cloudflare.com/workers/reference/apis/web-crypto/)
  might support different algorithms than cloudflare, depending on how you
  compiled node.js
* [`caches`](https://developers.cloudflare.com/workers/reference/apis/cache/) are
  memory only and flush upon restart
* [`HTMLRewriter`](https://developers.cloudflare.com/workers/reference/apis/html-rewriter/) is not supported


## Usage
While primarily a command line interface, cf-emu supports some additional usage
patterns which are described in this document. For a list of supported options,
see the [CLI definitions](src/cli.js) or run:
```sh
cf-emu --help
```

### As a development API server
Start an API server on `localhost:1234` that will (re)deploy cloudflare workers
on `localhost:8080` when new code is sent or if they crash:
```bash
cf-emu --api 1234 --port 8080 --watchdog
```

Since this is a RCE vector, the API server will refuse to start if neither
`CF_TOKEN` (for token based authentication) nor `CF_EMAIL` and `CF_APIKEY` (for
api key based authentication) environment variables are set. They don't have to
be valid cloudflare credentials (a simple string match is performed) however
they need to be defined and sent when deploying new code. You may bypass this
behavior by setting the `--unsafe` flag though you should be aware that
`fetch()` by default works across domain if the destination is `localhost`


### As a test helper

You can also import `cf-emu/runtime` in your unit tests to export all
implemented runtime APIs as globals.

If you want to manually invoke your fetch listeners, they are available as the
default export of the runtime module as an `Array` of `function`s. Note that
this Array can be mutated over time by additional calls to `addEventListener` /
`removeEventListener` and its length can be safely set to 0 to remove all
handlers:

`handler.js`:
```javascript
addEventListener('fetch', ev => {
    ev.respondWith(new Response('hello world'))
})
```

`handler.test.js`:
```javascript
describe('handler.js', () => {
    let handlers
    before(() => {
        // the runtime only replaces objects that don't exist, though if you are
        // relying on this in multiple tests, make sure you flush `require.cache`
        global.Response = x => x
        handlers = require('cf-emu/runtime')

        require('./handler.js')
    })
    afterEach(() => handlers.length = 0) // flush all handlers for the next test

    it('returns hello world', () => {
        let [first] = handlers
        first({
            respondWith(text) {
                assert.equal(text, 'hello world')
            }
        })
    })
})
```

Alternatively, you can call `cf-emu` programatically and use `fetch()` to
interact with your deployed worker, though this is slower because is involves
subprocesses:
`integration.test.js`:
```javascript
let emu = require('cf-emu')

describe('handler.js', () => {
    let instance
    before((next) => {
        instance = emu({
            input: './handler.js', // you can of course also use multipart here
            port: 8080
        })
        setTimeout(next, 1000) // wait 1s for the server to start
    })
    after(() => instance.close())
    // hint: there is also instance.kill(), but it may break code coverage

    it('returns hello world', async () => {
        let res = await fetch('http://localhost:8080/')
        assert.equal(await res.text(), 'hello world')
    })
})
```

### As a production server
I guess if you really want to, I can't exactly stop you from putting a bunch of
these in standalone mode behind a load balancer, but I definitely won't
encourage you to do so:
* for one, while this module is tested for conformance, no real thought has been
  given to performance, security and memory usage; then again, the same was true
  for `node.js` itself when it first released so YMMV
* some parts of the runtime (e.g. the `caches` object) could be considered mocks
  as they don't really do anything useful; this can however be mitigated with
  the `--require` option if you want to implement your own versions
* error propagation is probably not perfect; I'm not currently aware of any
  classes of errors that fail silently or result in a DoS, but I make no claim
  to have exhausted all possible error cases
