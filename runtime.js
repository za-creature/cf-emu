global.self = global


// https://developers.cloudflare.com/workers/reference/apis/standard
global.atob = global.atob || (s => {
    let data = Buffer.from(s, 'base64')
    let b = [], i = 0, j = 0, len = data.length
    do {
        j = Math.min(len, i + 16384)
        b.push(String.fromCharCode(...data.slice(i, j)))
        i = j
    } while(i < len)
    return b.join('')
})
global.btoa = global.btoa || (b => Buffer.from(b, 'ascii').toString('base64'))
// setInterval, clearInterval, setTimeout and clearTimeout are supported natively
/*istanbul ignore next*/
global.URL = global.URL || require('url').URL


// https://developers.cloudflare.com/workers/reference/apis/fetch/
if(!(global.fetch && global.Headers && global.Response && global.Request)) {
    let node_fetch = require('node-fetch')
    global.fetch = node_fetch
    global.Headers = node_fetch.Headers
    global.Response = node_fetch.Response
    global.Request = node_fetch.Request
    // note: request.formData() is implemented in server.js
}
global.FormData = global.FormData || require('./lib/form_data')


// https://developers.cloudflare.com/workers/reference/apis/fetch-event/
let handlers = module.exports = []
global.addEventListener = (event, callback) => {
    if(event != 'fetch')
        throw new Error('only "fetch" events are implemented')
    if(typeof callback != 'function')
        throw new TypeError('event listeners must be functions')
    handlers.push(callback)
}
global.removeEventListener = (event, callback, index) => {
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
// bindings are implemented in server.js

// https://developers.cloudflare.com/workers/reference/apis/streams/
// streams - NOT YET IMPLEMENTED

// https://developers.cloudflare.com/workers/reference/apis/kv/
// kv - NOT YET IMPLEMENTED


// https://developers.cloudflare.com/workers/reference/apis/encoding/
/*istanbul ignore if*/
if(!global.TextEncoder || !global.TextDecoder || !Promise.allSettled) {
    let node_10 = require('./lib/node_10')
    global.TextEncoder = global.TextEncoder || node_10.TextEncoder
    global.TextDecoder = global.TextDecoder || node_10.TextDecoder
    Promise.allSettled = Promise.allSettled || node_10.Promise_allSettled
}


// https://developers.cloudflare.com/workers/reference/apis/web-crypto/
if(!global.crypto || crypto._toBuf) {
    let node_crypto = require('crypto')
    global.crypto = {
        getRandomValues(buffer) {
            node_crypto.randomFillSync(buffer)
            return buffer
        },
        subtle: require('subtle')
    }
    crypto.subtle.digest = async function(algo, str) {
        return node_crypto.createHash(algo.replace('-', '')).update(str).digest('')
    }
}


// https://developers.cloudflare.com/workers/reference/apis/cache/
if(!global.caches) {
    let MemoryCache = require('./lib/memory_cache')
    global.caches = {
        default: new MemoryCache()
    }
}


// https://developers.cloudflare.com/workers/reference/apis/html-rewriter/
// HTMLRewriter - not implemented
