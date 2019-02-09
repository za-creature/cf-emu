let MemoryCache = require('./memory_cache')

let {assert} = require('chai')
let {createServer} = require('http')


describe('MemoryCache', () => {
    describe('put', () => {
        let cache = new MemoryCache()
        it('rejects non-http urls', () => assert.throws(() => cache.put(
            new Request('ftp://foo.bar/baz'),
            new Response('test')
        ), 'HTTP'))

        it('rejects partial content', () => assert.throws(() => cache.put(
            new Request('http://example.com'),
            new Response('hello world', {
                status: 206,
                headers: {'content-range': 'bytes 0-10/1234'}
            })
        ), 'ranges'))

        it('rejects non-GET requests', () => assert.throws(() => cache.put(
            new Request('http://example.com', {method: 'POST'}),
            new Response('ok')
        )), 'support')

        it('respects the vary header', async () => {
            let url = 'https://example.com/vary#foo'
            let url_response = new Response('identity')

            let gzip_request = new Request(url, {headers: {'accept-encoding': 'gzip'}})
            let gzip_response = new Response('gzip', {headers: {
                vary: 'accept-encoding',
                'content-encoding': 'gzip'
            }})

            let br_request = new Request(url, {headers: {'accept-encoding': 'br'}})
            let br_response = new Response('br', {headers: {
                vary: 'accept-encoding',
                'content-encoding': 'br'
            }})
            await cache.put(gzip_request, gzip_response)
            await cache.put(br_request, br_response)
            await cache.put(url, url_response)

            assert.equal('identity', await (await cache.match(url)).text())
            assert.equal('gzip', await (await cache.match(gzip_request)).text())
            assert.equal('br', await (await cache.match(br_request)).text())
        })
    })


    describe('matchAll', () => {
        let cache = new MemoryCache()
        let url = 'http://foo.bar/baz'
        let get = new Request(url)
        let post = new Request(url, {method: 'POST'})
        before(() => cache.put(get, new Response('baz')))

        it('supports strings', async () => {
            assert.isNotEmpty(await cache.matchAll(url))
        })

        it('does not match non-GET requests', async () => {
            assert.isEmpty(await cache.matchAll(post))
        })

        it('implements ignoreMethod', async () => {
            assert.isNotEmpty(await cache.matchAll(post, {ignoreMethod: true}))
        })
    })


    describe('match', () => {
        let cache = new MemoryCache()
        let call = (url, headers={}) => cache.match(new Request(url, {headers}))

        let file = 'https://example.com/file.txt'
        let custom_mdate = 'https://example.com/custom_mdate'
        before(async () => {
            await cache.put(file, new Response('hello world', {headers: {
                'content-type': 'text/plain',
                'content-length': 11,
                etag: '"etag1234"',
                'cache-control': 'max-age=2,min-fresh=1'
            }}))
            await cache.put(custom_mdate, new Response('hello world', {headers: {
                'content-type': 'text/plain',
                'content-length': 11,
                etag: '"etag1234"',
                'last-modified': DEFAULT_LAST_MODIFIED,
                'cache-control': 'private'
            }}))
        })
        it('expires stale requests', async () => {
            let url = 'http://foo.bar/expires'
            await cache.put(url, new Response('test', {
                headers: {expires: DEFAULT_LAST_MODIFIED}
            }))
            assert.isUndefined(await cache.match(url))
        })

        it('respects etags', async () => {
            let res = await call(file, {'if-none-match': '"etag1234"'})
            assert.equal(res.status, 304)
            assert.isEmpty(await res.text())

            res = await call(file, {'if-none-match': '"blah"'})
            assert.equal(res.status, 200)

            res = await call(file, {'if-none-match': '"etag", "etag1234"\t, wat'})
            assert.equal(res.status, 304)
        })

        let DEFAULT_LAST_MODIFIED = 'Wed, 03 Jun 2020 19:36:20 GMT'
        it('respects last-modified', async () => {
            let res = await call(file)
            assert(res.headers.has('last-modified'))

            res = await call(custom_mdate)
            assert.equal(res.headers.get('last-modified'), DEFAULT_LAST_MODIFIED)

            res = await call(custom_mdate, {'if-modified-since': DEFAULT_LAST_MODIFIED})
            assert.equal(res.status, 304)
            assert.isEmpty(await res.text())

            res = await call(file, {'if-modified-since': 'Tue, 02 Jun 2020 19:36:20 GMT'})
            assert.equal(res.status, 200)
        })

        it('supports range requests', async () => {
            // unsupported range
            let res = await call(file, {'range': 'qubits=1024'})
            assert.equal(res.status, 200)

            // byte-range edge cases
            res = await call(file, {'range': 'bytes=6-'})
            assert.equal(res.status, 206)
            assert.equal(res.headers.get('content-length'), 5)
            assert.equal(res.headers.get('content-range'), 'bytes 6-10/11')
            assert.equal(await res.text(), 'world')

            res = await call(file, {'range': 'bytes=-5'})
            assert.equal(res.status, 206)
            assert.equal(res.headers.get('content-length'), 5)
            assert.equal(res.headers.get('content-range'), 'bytes 6-10/11')
            assert.equal(await res.text(), 'world')

            res = await call(file, {'range': 'bytes=3-7'})
            assert.equal(res.status, 206)
            assert.equal(res.headers.get('content-length'), 5)
            assert.equal(res.headers.get('content-range'), 'bytes 3-7/11')
            assert.equal(await res.text(), 'lo wo')

            res = await call(file, {'range': 'bytes=20-30'})
            assert.equal(res.status, 416)
            assert.equal(res.headers.get('content-length'), 11)
            assert.equal(res.headers.get('content-range'), 'bytes */11')
            assert.equal(await res.text(), '')

            // if-range
            res = await call(file, {'if-range': '"foo"', 'range': 'bytes=0-4'})
            assert.equal(res.status, 200)

            res = await call(file, {'if-range': 'W/"foo", bar',
                                    'range': 'bytes=0-4'})
            assert.equal(res.status, 200)

            res = await call(custom_mdate, {'if-range': DEFAULT_LAST_MODIFIED,
                                            'range': 'bytes=0-1'})
            assert.equal(res.status, 206)

            res = await call(file, {'if-range': '"etag1234"',
                                    'range': 'bytes=0-4'})
            assert.equal(res.status, 206)

            // only return first range
            res = await call(file, {'range': 'bytes=0-4,-5'})
            assert.equal(res.status, 206)
            assert.equal(res.headers.get('content-length'), 5)
            assert.equal(res.headers.get('content-range'), 'bytes 0-4/11')
            assert.equal(await res.text(), 'hello')
        })

        it('throws when called with ignoreSearch or ignoreVary', async () => {
            let req = new Request('http://example.com')
            await assert.throws(() => cache.match(req, {ignoreSearch: true}), 'implement')
            await assert.throws(() => cache.match(req, {ignoreVary: true}), 'implement')
        })
    })


    describe('delete', () => {
        let cache = new MemoryCache()
        it('respects ignoreMethod', async () => {
            let url = 'http://foo.baz'
            await cache.put(url, new Response('hi'))
            let req = new Request(url, {method: 'HEAD'})
            await cache.delete(req)
            assert.equal(await (await cache.match(url)).text(), 'hi')
            await cache.delete(req, {ignoreMethod: true})
            assert.isUndefined(await cache.match(url))
        })


        it('deletes all variants', async () => {
            let url = 'http://foo.bar'
            let foo = new Request(url, {headers: {baz: 'foo'}})
            let bar = new Request(url, {headers: {baz: 'bar'}})
            await cache.put(foo, new Response('foo', {headers: {vary: 'baz'}}))
            await cache.put(bar, new Response('bar', {headers: {vary: 'baz'}}))
            assert.equal(await (await cache.match(foo)).text(), 'foo')
            assert.equal(await (await cache.match(bar)).text(), 'bar')
            await cache.delete(url)
            assert.isUndefined(await cache.match(foo))
            assert.isUndefined(await cache.match(bar))
        })
    })


    describe('add', () => {
        let server, port = Number(process.env.TEST_PORT)
        before(next => server = createServer((req, res) => {
            if(~req.url.indexOf('error'))
                res.statusCode = 400
            res.end('hi')
        }).listen(port, next))
        after(next => server.close(next))
        let cache = new MemoryCache()

        it('caches responses', async () => {
            let url = `http://localhost:${port}`
            await cache.addAll([url])
            assert.equal(await (await cache.match(url)).text(), 'hi')
        })

        it('throws on error', () => {
            let url = `http://localhost:${port}/error`
            return assert.throws(() => cache.add(url), 'status')
        })
    })

    describe('keys', async () => {
        let cache = new MemoryCache()
        let url = 'http://foo.bar'
        let foo = new Request(url, {headers: {baz: 'foo'}})
        let bar = new Request(url, {headers: {baz: 'bar'}})
        await cache.put(foo, new Response('foo', {headers: {vary: 'baz'}}))
        await cache.put(bar, new Response('bar', {headers: {vary: 'baz'}}))
        let str = 'http://example.com'
        await cache.put(str, new Response(''))

        it('matches urls', async () => {
            assert.deepEqual(await cache.keys(str), [new Request(str)])
        })

        it('matches requests', async () => {
            assert.deepEqual(await cache.keys(foo), [foo])
            assert.deepEqual(await cache.keys(bar), [bar])
        })

        it('matches all', async () => {
            assert.deepEqual(await cache.keys(), [foo, bar, new Request(str)])
        })
    })
})