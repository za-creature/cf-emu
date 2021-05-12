exports.self = exports

// https://developers.cloudflare.com/workers/reference/apis/standard
exports.atob = s => {
    let data = Buffer.from(s, 'base64')
    let b = [], i = 0, j = 0, len = data.length
    do {
        j = Math.min(len, i + 16384)
        b.push(String.fromCharCode(...data.slice(i, j)))
        i = j
    } while(i < len)
    return b.join('')
}
exports.btoa = b => Buffer.from(b, 'ascii').toString('base64')
Object.assign(exports, {setInterval, clearInterval, setTimeout, clearTimeout})
exports.URL = global.URL || require('url').URL


// https://developers.cloudflare.com/workers/reference/apis/fetch/
let node_fetch = () => require('node-fetch')
exports.fetch = global.fetch || node_fetch()
exports.Headers = global.Headers || node_fetch().Headers
exports.Request = global.Request || node_fetch().Request
exports.Response = global.Response || node_fetch().Response
exports.Response.redirect = exports.Response.redirect || (
    (url, status=302) => new exports.Response(null, {status, headers: {'Location': url}})
)
// note: Request.formData() is implemented in worker.js for the incoming request
exports.FormData = global.FormData || require('./lib/form_data')


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


// https://developers.cloudflare.com/workers/reference/apis/encoding/
let node_10 = () => require('./lib/node_10')
exports.TextEncoder = global.TextEncoder || node_10().TextEncoder
exports.TextDecoder = global.TextDecoder || node_10().TextDecoder
Promise.allSettled = Promise.allSettled || node_10().Promise_allSettled


// https://developers.cloudflare.com/workers/reference/apis/web-crypto/
let {randomFillSync, createHash} = require('crypto')
exports.crypto = {
    getRandomValues: randomFillSync,
    subtle: Object.assign(require('subtle'), {
        digest: (algo, str) => createHash(algo.replace('-', '')).update(str).digest()
    })
}

// https://developers.cloudflare.com/workers/reference/apis/cache/
exports.caches = global.caches || {default: new (require('./lib/memory_cache'))}

// https://developers.cloudflare.com/workers/reference/apis/html-rewriter/
// HTMLRewriter - not implemented
