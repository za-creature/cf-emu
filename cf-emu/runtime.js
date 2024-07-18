exports.self = exports

;[
    // https://developers.cloudflare.com/workers/reference/apis/standard
    'atob', 'btoa',
    'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    // https://developers.cloudflare.com/workers/reference/apis/fetch/
    'fetch', 'URL', 'Headers', 'Request', 'Response', 'FormData',

    // https://developers.cloudflare.com/workers/reference/apis/encoding/
    'TextEncoder', 'TextDecoder',

    // https://developers.cloudflare.com/workers/reference/apis/web-crypto/
    'crypto',
].forEach(key => exports[key] = global[key])


// https://developers.cloudflare.com/workers/reference/apis/fetch-event/
let handlers = []
Object.defineProperty(exports, 'handlers', {enumerable: false, value: handlers})
exports.addEventListener = (event, callback) => {
    if(event != 'fetch')
        throw new Error('only "fetch" events are implemented')
    if(typeof callback != 'function')
        throw new TypeError('event listeners must be functions')
    handlers.push(callback)
}
exports.removeEventListener = (event, callback, index) => {
    if(event != 'fetch')
        throw new Error('only "fetch" events are implemented')
    if(typeof callback != 'function')
        throw new TypeError('event listeners must be functions')
    if(~(index = handlers.indexOf(callback)))
        handlers.splice(index, 1)
    else
        throw new Error('the specified event handler is not currently bound')
}


// https://developers.cloudflare.com/workers/reference/apis/environment-variables/
// bindings are implemented in lib/multipart.js and bound in worker.js

// https://developers.cloudflare.com/workers/reference/apis/streams/
// streams - NOT YET IMPLEMENTED

// https://developers.cloudflare.com/workers/reference/apis/kv/
// kv - NOT YET IMPLEMENTED

// https://developers.cloudflare.com/workers/reference/apis/cache/
exports.caches = global.caches || {default: new (require('./lib/memory_cache'))}

// https://developers.cloudflare.com/workers/reference/apis/html-rewriter/
// HTMLRewriter - not implemented
