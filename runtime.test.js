let handlers = require('./runtime')

let {assert} = require('chai')


describe('runtime', () => {
    it('self', () => assert(self === global))

    it('atob', () => {
        assert.isFunction(atob)
        assert.equal(atob('aGk='), 'hi')
    })

    it('btoa', () => {
        assert.isFunction(btoa)
        assert.equal(btoa('hi'), 'aGk=')
    })

    // tested upstream in node.js runtime, only test binding
    it('URL', () => assert.isFunction(URL))

    // tested upstream (native or node-fetch) , only test bindings
    it('fetch', () => assert.isFunction(fetch))
    it('Headers', () => assert.isFunction(Headers))
    it('Request', () => assert.isFunction(Request))
    it('Response', () => assert.isFunction(Response))

    // tested in lib/form_data, only test binding
    it('FormData', () => assert.isFunction(FormData))


    // on(fetch) handlers
    let noop = () => {}
    let noop2 = () => {}

    beforeEach(() => handlers.length = 0)
    it('addEventListener', () => assert.isFunction(addEventListener))
    describe('addEventListener', () => {
        it('supports multiple events', () => {
            addEventListener('fetch', noop)
            addEventListener('fetch', noop2)
            assert.deepEqual(handlers, [noop, noop2])
        })

        it('only supports fetch', () => assert.throws(
            () => addEventListener('error'),
        'implemented'))

        it('requires a function', () => assert.throws(
            () => addEventListener('fetch', {}),
        'function'))

    })

    it('removeEventListener', () => assert.isFunction(removeEventListener))
    describe('removeEventListener', () => {
        it('only removes the correct event', () => {
            addEventListener('fetch', noop)
            addEventListener('fetch', noop2)

            removeEventListener('fetch', noop)
            assert.deepEqual(handlers, [noop2])

            addEventListener('fetch', noop)
            removeEventListener('fetch', noop2)
            assert.deepEqual(handlers, [noop])

            removeEventListener('fetch', noop)
            assert.empty(handlers)
        })

        it('throws when event is not bound', () => assert.throws(() => {
            removeEventListener('fetch', noop)
        }, 'bound'))

        it('only supports fetch', () => assert.throws(
            () => removeEventListener('error')
        , 'implemented'))

        it('requires a function', () => assert.throws(
            () => removeEventListener('fetch', {}),
        'function'))

    })


    // encoding & decoding
    assert.isFunction(TextEncoder)
    assert.isFunction(TextDecoder)

    // crypto
    it('crypto', () => assert.isObject(crypto))
    describe('crypto', () => {
        it('getRandomValues', () => {
            assert.isFunction(crypto.getRandomValues)
            let foo = new Uint8Array(16)
            crypto.getRandomValues(foo)
            assert(foo.some(x => x > 0))
        })
        it('subtle', () => assert.isObject(crypto.subtle))
        it('subtle.digest', async () => {
            assert.isFunction(crypto.subtle.digest)
            let hash = await crypto.subtle.digest('SHA-256',
                new TextEncoder().encode('hello world')
            )
            assert.equal(hash[0], 185)
        })
    })


    // tested in lib/memory_cache, only test bindings
    it('caches', () => {
        assert.isObject(caches)
        assert.isObject(caches.default)
        assert.isFunction(caches.default.match)
        assert.isFunction(caches.default.put)
        assert.isFunction(caches.default.delete)
    })


    // allow custom runtimes to override most implementations
    describe('override', () => {
        let cases = {
            self: false, // global is global is global
            atob: true,
            btoa: true,
            URL: true,
            fetch: true,
            Headers: true,
            Request: true,
            Response: true,
            FormData: true,
            addEventListener: false,
            removeEventListener: false,
            TextDecoder: true,
            TextEncoder: true,
            crypto: true,
            caches: true
        }
        for(let [name, status] of Object.entries(cases))
            it(name, () => assert((global[name] === patched[name]) === status))

        // flush module cache, replace globals with Symbols, re-import runtime then
        // restore globals and module cache after all tests are complete
        let patched = Object.keys(cases).reduce((obj, key) => (obj[key] =
                                                Symbol(), obj), {})
        let old_globals = {}, old_module, runtime = require.resolve('./runtime')
        before(() => {
            old_module = require.cache[runtime]
            for(let [key, val] of Object.entries(patched)) {
                old_globals[key] = global[key]
                global[key] = val
            }
            delete require.cache[runtime]
            require(runtime)
        })
        after(() => {
            require.cache[runtime] = old_module
            for(let [key, val] of Object.entries(old_globals))
                if(typeof val === 'undefined')
                    delete global[key]
                else
                    global[key] = val
        })
    })
})
