let g = require('./runtime')

let {assert} = require('chai')


describe('runtime', () => {
    // on(fetch) handlers
    let noop = () => {}
    let noop2 = () => {}

    beforeEach(() => g.handlers.length = 0)
    describe('addEventListener', () => {
        it('is a function', () => assert.isFunction(g.addEventListener))
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

    describe('removeEventListener', () => {
        it('is a function', () => assert.isFunction(g.removeEventListener))
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


    // these are now provided natively and (presumably) tested
    it('self', () => assert(g.self === g))

    describe('encoding and decoding', () => {
        it('TextEncoder', () => assert.isFunction(g.TextEncoder))
        it('TextDecoder', () => assert.isFunction(g.TextDecoder))
        it('atob', () => {
            assert.isFunction(g.atob)
            assert.equal(g.atob('aGk='), 'hi')
        })

        it('btoa', () => {
            assert.isFunction(g.btoa)
            assert.equal(g.btoa('hi'), 'aGk=')
        })
    })

    it('setTimeout', () => assert.isFunction(g.setTimeout))
    it('clearTimeout', () => assert.isFunction(g.clearTimeout))
    it('setInterval', () => assert.isFunction(g.setInterval))
    it('clearInterval', () => assert.isFunction(g.clearInterval))

    it('URL', () => assert.isFunction(g.URL))
    it('fetch', () => assert.isFunction(g.fetch))
    it('Headers', () => assert.isFunction(g.Headers))
    it('Request', () => assert.isFunction(g.Request))
    it('FormData', () => assert.isFunction(g.FormData))

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

    describe('crypto', () => {
        it('getRandomValues', () => {
            assert.isFunction(g.crypto.getRandomValues)
            let foo = new Uint8Array(16)
            g.crypto.getRandomValues(foo)
            assert(foo.some(x => x > 0))
        })
        it('subtle', () => {
            assert.isFunction(g.crypto.subtle.encrypt)
            assert.isFunction(g.crypto.subtle.encrypt)
            assert.isFunction(g.crypto.subtle.decrypt)
            assert.isFunction(g.crypto.subtle.sign)
            assert.isFunction(g.crypto.subtle.verify)
            assert.isFunction(g.crypto.subtle.digest)
            assert.isFunction(g.crypto.subtle.generateKey)
            assert.isFunction(g.crypto.subtle.deriveKey)
            assert.isFunction(g.crypto.subtle.deriveBits)
            assert.isFunction(g.crypto.subtle.importKey)
            assert.isFunction(g.crypto.subtle.exportKey)
            assert.isFunction(g.crypto.subtle.wrapKey)
            assert.isFunction(g.crypto.subtle.unwrapKey)
        })
        it('subtle.digest', async () => {
            assert.isFunction(g.crypto.subtle.digest)
            let hash = await g.crypto.subtle.digest('SHA-256',
                new g.TextEncoder().encode('hello world')
            )
            assert.equal(new Uint8Array(hash)[0], 185)
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
