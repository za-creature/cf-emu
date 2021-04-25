[![npm](https://img.shields.io/npm/v/cf-emu)](https://www.npmjs.com/package/cf-emu)
[![tests](https://github.com/za-creature/cf-emu/workflows/test/badge.svg?branch=master&event=push)](https://github.com/za-creature/cf-emu/actions?query=workflow%3Atests+branch%3Amaster)
[![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/za-creature/1e4664346f422ed78c1cc07a6a5da580/raw/coverage.json)](https://za-creature.github.io/cf-emu)

# cf-emu
A local emulator for [cloudflare workers](https://www.cloudflare.com/products/cloudflare-workers/)


## Installation
```sh
npm install --save-dev cf-emu
```

## Known differences
* requests can consume arbitrary amounts of CPU time
* while `eval()` and `Function()` are disabled to prevent accidental use, this
  can be easily bypassed and should not be relied upon
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
`fetch()` works by default across domain if the destination is `localhost`


### As a test helper
If you import `cf-emu/runtime` in your unit tests and assign it to `global`, the
workers runtime API will be globally available to the code that you are testing
(assuming you do this before importing any code to be tested, for example in a
test config file).

If you want to manually invoke your fetch listeners (e.g. for unit tests), a
list of currently registered handlers is available as the non-enumerable
`handlers` export of the runtime module (it's an `Array` of `function`s). Note
that this `Array` will be mutated over time by calls to `addEventListener` and /
or `removeEventListener`, though you can safely discard all registered handlers
(e.g. for test clean-up) by setting its `length` to 0 (assigning it to `[]` will
not work as that just replaces your imported copy):


`handler.js`:
```javascript
addEventListener('fetch', ev => {
    ev.respondWith(new Response('hello world'))
})
```

`handler.test.js`:
```javascript
let handlers = require('cf-emu/runtime')
let {assert} = require('chai')

describe('handler.js', () => {
    before(() => require('./handler.js'))
    afterEach(() => handlers.length = 0) // flush all handlers for the next test

    it('returns hello world', () => {
        let [first] = handlers
        assert.isFunction(first, 'did not define an event handler')
        first({
            respondWith(text) {
                assert.equal(text, 'hello world', 'bad response body')
            }
        })
    })
})
```

Alternatively, you can call `cf-emu` programatically and use `fetch()` to
interact with your deployed worker, though this is significantly slower as it
involves subprocesses and should only be used for end-to-end tests:
`integration.test.js`:
```javascript
let emu = require('cf-emu')

describe('handler.js', () => {
    let instance
    before((next) => {
        instance = emu({
            input: './handler.js', // you can use multipart here instead
            port: 8080
        })
        setTimeout(next, 1000) // wait 1 second for the server to start (YMMV!)
    })
    after(() => instance.close())
    // hint: there is also instance.kill(), but that could break code coverage

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
* for one, while this module is somewhat tested for conformance, no real thought
  has been given to performance, security and memory usage; then again, the same
  was true for `node.js` itself when it first released so YMMV
* some parts of the runtime (e.g. the `caches` object) could be considered mocks
  as they don't really do anything useful; this can however be mitigated with
  the `--require` option if you want to implement your own versions
* error propagation is probably not perfect; I'm not currently aware of any
  classes of errors that fail silently or result in a DoS, but I make no claim
  to have exhausted all possible error cases
