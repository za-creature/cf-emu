let g = require('./runtime')

let {assert} = require('chai')


describe('runtime', () => {
    it('self', () => assert(g.self === g))

    it('atob', () => {
        assert.isFunction(g.atob)
        assert.equal(g.atob('aGk='), 'hi')
    })

    it('btoa', () => {
        assert.isFunction(g.btoa)
        assert.equal(g.btoa('hi'), 'aGk=')
    })

    // builtins
    it('setTimeout', () => assert.isFunction(g.setTimeout))
    it('clearTimeout', () => assert.isFunction(g.clearTimeout))
    it('setInterval', () => assert.isFunction(g.setInterval))
    it('clearInterval', () => assert.isFunction(g.clearInterval))

    // tested upstream in node.js runtime, only test binding
    it('URL', () => assert.isFunction(g.URL))

    // tested upstream (native or node-fetch) , only test bindings
    it('fetch', () => assert.isFunction(g.fetch))
    it('Headers', () => assert.isFunction(g.Headers))
    it('Request', () => assert.isFunction(g.Request))
    describe('Response', () => {
        it('binding', () => {
            assert.isFunction(g.Response)
        })

        it('redirect', () => {
            assert.isFunction(g.Response.redirect)
            let res = g.Response.redirect('http://example.com/')
            assert.equal(res.status, 302)
            assert.equal(res.headers.get('Location'), 'http://example.com/')

            res = g.Response.redirect('https://example.com/', 301)
            assert.equal(res.status, 301)
            assert.equal(res.headers.get('Location'), 'https://example.com/')
        })
    })

    // tested in lib/form_data, only test binding
    it('FormData', () => assert.isFunction(g.FormData))


    // on(fetch) handlers
    let noop = () => {}
    let noop2 = () => {}

    beforeEach(() => g.handlers.length = 0)
    it('addEventListener', () => assert.isFunction(g.addEventListener))
    describe('addEventListener', () => {
        it('supports multiple events', () => {
            g.addEventListener('fetch', noop)
            g.addEventListener('fetch', noop2)
            assert.deepEqual(g.handlers, [noop, noop2])
        })

        it('only supports fetch', () => assert.throws(
            () => g.addEventListener('error'),
        'implemented'))

        it('requires a function', () => assert.throws(
            () => g.addEventListener('fetch', {}),
        'function'))

    })

    it('removeEventListener', () => assert.isFunction(g.removeEventListener))
    describe('removeEventListener', () => {
        it('only removes the correct event', () => {
            g.addEventListener('fetch', noop)
            g.addEventListener('fetch', noop2)

            g.removeEventListener('fetch', noop)
            assert.deepEqual(g.handlers, [noop2])

            g.addEventListener('fetch', noop)
            g.removeEventListener('fetch', noop2)
            assert.deepEqual(g.handlers, [noop])

            g.removeEventListener('fetch', noop)
            assert.empty(g.handlers)
        })

        it('throws when event is not bound', () => assert.throws(() => {
            g.removeEventListener('fetch', noop)
        }, 'bound'))

        it('only supports fetch', () => assert.throws(
            () => g.removeEventListener('error')
        , 'implemented'))

        it('requires a function', () => assert.throws(
            () => g.removeEventListener('fetch', {}),
        'function'))

    })


    // encoding & decoding
    assert.isFunction(g.TextEncoder)
    assert.isFunction(g.TextDecoder)

    // crypto
    it('crypto', () => assert.isObject(g.crypto))
    describe('crypto', () => {
        it('getRandomValues', () => {
            assert.isFunction(g.crypto.getRandomValues)
            let foo = new Uint8Array(16)
            g.crypto.getRandomValues(foo)
            assert(foo.some(x => x > 0))
        })
        it('subtle', () => assert.isObject(g.crypto.subtle))
        it('subtle.digest', async () => {
            assert.isFunction(g.crypto.subtle.digest)
            let hash = await g.crypto.subtle.digest('SHA-256',
                new g.TextEncoder().encode('hello world')
            )
            assert.equal(hash[0], 185)
        })
    })


    // tested in lib/memory_cache, only test bindings
    it('caches', () => {
        assert.isObject(g.caches)
        assert.isObject(g.caches.default)
        assert.isFunction(g.caches.default.match)
        assert.isFunction(g.caches.default.put)
        assert.isFunction(g.caches.default.delete)
    })
})
