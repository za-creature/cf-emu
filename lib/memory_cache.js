let {http_date} = require('./util')


let parse_options = (req, options) => {
    if(!(req instanceof Request))
        req = new Request(req)

    if(!req.url.startsWith('http:') && !req.url.startsWith('https:'))
        throw new TypeError('request URL is not HTTP')
    if(options.ignoreSearch || options.ignoreVary)
        throw new TypeError('ignoreSearch and / or ignoreVary are not' +
                            ' implemented;  please alter the request and /' +
                            ' or response prior to using the cache')
    let url = req.url
    let frag = url.indexOf('#')
    if(~frag)
        url = url.slice(0, frag)
    return [req, url]
}

let matchAll = (haystack = [], needle, negate_vary=false) => haystack.filter(
    ([req, res]) => (
        // filter out expired requests
        !res.headers.has('expires') ||
        new Date(res.headers.get('expires')).getTime() > Date.now()
    ) && (
        // vary match
        !res.headers.has('vary') ||
        res.headers.get('vary').split(',').map(x => x.trim()).every(field =>
            (needle.headers.get(field) == req.headers.get(field)) != negate_vary
        )
    )
)


module.exports = class MemoryCache {
    // this polyfill is intended to replicate the cloudflare caching behavior,
    // so as such is not spec-compliant; other than some unimplemented methods,
    // the main differences are that it respects the 'expires' & 'cache-control'
    // response headers, and also the 'if-none-match', 'if-modified-since',
    // 'if-range' and 'range' request headers according to http spec.
    // pull requests welcome, and you can also completely bypass this by
    // defining a global `caches` object in your custom runtime
    constructor() {
        this.data = new Map()
    }

    async match(req, options) {
        return (await this.matchAll(req, options))[0]
    }

    async matchAll(req, options={}, /*local*/ url) {
        [req, url] = parse_options(req, options)
        if(req.method != 'GET' && !options.ignoreMethod)
            return []
        req = new Request(req, {'method': 'GET'})
        return matchAll(this.data.get(url), req).map(([, res]) => {
            // shortcircuit response body if unchanged...
            if(( // ... by etag
                res.headers.has('etag') &&
                req.headers.has('if-none-match') &&
                req.headers.get('if-none-match')
                    .split(',')
                    .some(tag => tag.trim() == res.headers.get('etag')
                )
            ) || ( // ... by last-modified
                res.headers.has('last-modified') &&
                req.headers.has('if-modified-since') &&
                !req.headers.has('if-none-match') &&
                new Date(req.headers.get('if-modified-since')).getTime() >=
                new Date(res.headers.get('last-modified')).getTime()
            ))
                return new Response(null, {'status': 304,
                                           'headers': res.headers})

            // partial content / resumable download support
            let range = req.headers.get('range')
            if(range && range.startsWith('bytes=')) {
                range = range.slice(6)
                let comma = range.indexOf(',')
                if(~comma)
                    range = range.slice(0, comma)

                let [range_start, range_end] = range.split('-', 2).map(x => parseInt(x, 10))
                let content_length = res.headers.get('content-length')
                let content_length_1 = content_length - 1 // weird spec but okay
                if(isNaN(range_end))
                    range_end = content_length_1
                if(isNaN(range_start)) {
                    range_start = content_length - range_end
                    range_end = content_length_1
                }

                range_start = Math.max(0, range_start)
                range_end = Math.min(range_end, content_length_1)
                if(range_start > range_end) {
                    let headers = new Headers(res.headers)
                    headers.set('content-range', `bytes ${'*'}/${content_length}`)
                    return new Response(null, {'status': 416, headers})
                }
                let etag = res.headers.has('etag') &&
                           res.headers.get('etag').trim()
                let mdate = res.headers.has('last-modified') &&
                            new Date(res.headers.get('last-modified')).getTime()
                let match = req.headers.has('if-range') &&
                            req.headers.get('if-range').trim()
                match = match && (match.startsWith('"') || match.startsWith('W/"')
                    ? etag && match != etag
                    : mdate && mdate > new Date(match).getTime())
                if(!match) {
                    let headers = new Headers(res.headers)
                    headers.set('content-range',
                                `bytes ${range_start}-${range_end}/${content_length}`)
                    headers.set('content-length', range_end - range_start + 1)
                    return new Response(res.body.slice(range_start, range_end + 1),
                                        {'status': 206, headers})
                }
            }
            return new Response(res.body, res)
        })
    }

    async add(req) {
        [req] = parse_options(req, {})
        let res = await fetch(req)
        if(!res.ok)
            throw new TypeError('bad status code')
        return this.put(req, res)
    }

    async addAll(reqs) {
        return Promise.all(reqs.map(req => this.add(req)))
    }

    async put(req, res, /*local*/ url) {
        [req, url] = parse_options(req, {})
        if(req.method != 'GET')
            throw new TypeError('only GET is supported')
        if(res.status == 206)
            throw new TypeError('please `put` entire payload in cache; `match`' +
                                ' handles ranges for you')

        // get all valid cached responses that don't vary-match request
        let result = matchAll(this.data.get(url), req, true)

        // normalize headers
        res.headers.set('CF-Cache-Status', 'HIT')
        let now = Date.now()
        if(!res.headers.has('last-modified'))
            res.headers.set('last-modified', http_date())
        if(res.headers.has('expires') && !res.headers.has('cache-control')) {
            let delta = new Date(res.headers.get('expires')).getTime() - now
            res.headers.set('cache-control', `max-age=${delta/1000|0}`)
        }
        res.headers.delete('expires')
        if(res.headers.has('cache-control')) {
            let age = 0, fresh = 0
            for(let piece of res.headers.get('cache-control')
                                        .split(',')
                                        .map(_ => _.replace(/\s+/g, '')))
                if(piece.startsWith('max-age=') || piece.startsWith('s-max-age='))
                    age = Number(piece.split('=', 2)[1])
                else if(piece.startsWith('min-fresh='))
                    fresh = Number(piece.split('=', 2)[1]) // srsly?
            if(age - fresh)
                res.headers.set('expires', http_date(now + 1000 * (age - fresh)))
        }

        // resolve body to string
        res = new Response(await res.arrayBuffer(), res)
        result.push([req, res])
        this.data.set(url, result)
    }

    async delete(req, options={}, /*local*/ url) {
        [req, url] = parse_options(req, options)
        if(req.method == 'GET' || options.ignoreMethod)
            this.data.delete(url)
    }

    async keys(req, options={}, /*local*/ url) {
        if(req) {
            [req, url] = parse_options(req, options)
            return matchAll(this.data.get(url), req).map(([req]) => req)
        }

        let result = []
        for(let key of this.data.keys())
            for(let [req] of this.data.get(key))
                result.push(req)
        return result
    }
}
