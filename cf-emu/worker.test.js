let serve = require('./worker')
let {translate, compile} = serve
let {Stackless, buffer, stream} = require('./lib/util')

let {assert} = require('chai')
let {createServer} = require('http')
let {createConnection} = require('net')


describe('server', () => {
    let port = TEST_PORT
    let keepalive = TEST_KEEPALIVE
    describe('translate', () => {
        let handlers, options
        beforeEach(() => (handlers = [], options = {}))
        let call = (url='/', init={}) => {
            if(typeof url == 'object') {
                init = url
                url = '/'
            }
            let {method, headers, body=null} = init
            let req = Object.assign(stream(body), {
                method,
                socket: {
                    localAddress: '127.0.0.1',
                    remoteAddress: '127.0.0.1'
                },
                headers,
                url
            })
            req.method = method || 'GET'
            req.headers = headers || {}
            let status = null
            headers = {}
            let res = buffer()
            res.setHeader = (key, val) => void (headers[key] = val)
            Object.defineProperty(res, 'statusCode', {
                get() { return status },
                set(val) { status = val }
            })
            translate(handlers, options)(req, res)
            return res.promise.then(body => new Response(status == 204 ? null : body, {status, headers}))
        }

        it('forwards method, url and headers', async () => {
            let req
            handlers = [e => {
                req = e.request
                e.respondWith(new Response(null, {status: 204, headers: {baz: 'qux'}}))
            }]
            let res = await call('/foo', {headers: {bar: 'baz'}})
            assert.equal(req.url, 'http://127.0.0.1/foo')
            assert.equal(req.method, 'GET')
            assert.equal(req.headers.get('bar'), 'baz')
            assert.equal(res.status, 204)
            assert.equal(res.headers.get('baz'), 'qux')
        })

        it('forwards the promised body', async () => {
            handlers = [e => e.respondWith(
                e.request.text().then(body => new Response(body))
            )]
            let res = await call({method: 'PUT', body: 'hello'})
            assert.equal(await res.text(), 'hello')
        })

        it('sets cf headers', async () => {
            let req
            handlers = [e => (req = e.request, e.respondWith(new Response('')))]
            options.location = 'FOO'
            await call()
            assert.equal(req.headers.get('cf-ipcountry'), 'FOO')
            assert.equal(req.headers.get('cf-connecting-ip'), '127.0.0.1')
            assert.equal(req.headers.get('x-forwarded-for'), '127.0.0.1')
            assert.equal(req.headers.get('x-forwarded-proto'), 'http')
            assert(req.headers.get('cf-ray').endsWith('-DEV'))
        })

        it('returns 500 on no response', async () => {
            let res = await call()
            assert.equal(res.status, 500)
            assert.include(await res.text(), 'respondWith')
        })

        it('returns 500 on (async) error', async () => {
            handlers = [() => {throw new Error('foo')}]
            let res = await call()
            assert.equal(res.status, 500)
            assert.include(await res.text(), 'foo')

            handlers = [e => e.respondWith(Promise.reject(new Error('foo')))]
            res = await call()
            assert.equal(res.status, 500)
            assert.include(await res.text(), 'foo')
        })

        it('returns 500 on invalid (async) response', async () => {
            handlers = [e => e.respondWith('foo')]
            let res = await call()
            assert.equal(res.status, 500)
            assert.include(await res.text(), 'invalid response type')

            handlers = [e => e.respondWith(Promise.resolve('foo'))]
            res = await call()
            assert.equal(res.status, 500)
            assert.include(await res.text(), 'invalid response type')
        })

        it('returns 500 on invalid (async) error', async () => {
            handlers = [() => {throw 'bar'}]
            let res = await call()
            assert.equal(res.status, 500)
            assert.include(await res.text(), 'invalid error type')

            handlers = [e => e.respondWith(Promise.reject('bar'))]
            res = await call()
            assert.equal(res.status, 500)
            assert.include(await res.text(), 'invalid error type')
        })

        it('implements non-blocking event.waitUntil()', async () => {
            let delayed = false
            let timer = sleep(20).then(() => {
                delayed = true
                throw new Stackless('foo')
            })
            handlers = [e => {
                e.waitUntil('whatever')
                e.waitUntil(timer)
                e.respondWith(new Response('done'))
            }]
            await call()
            assert(!delayed)
            await assert.throws(() => timer, 'foo')
            assert(delayed)
        })

        it('calls handlers until one responds or throws', async () => {
            let calls = 0
            handlers = [
                () => calls++,
                e => e.respondWith(new Response(`${calls++}`)),
                () => calls++
            ]
            await call()
            assert.equal(calls, 2)

            calls = 0
            handlers[1] = () => {throw new Error(calls++)}
            await call()
            assert.equal(calls, 2)
        })

        it('handles multiple cookies', async () => {
            let headers = new Headers()
            headers.append('set-cookie', 'foo=bar')
            headers.append('set-cookie', 'baz=qux')
            handlers = [e => e.respondWith(new Response('', {headers}))]
            let res = await call()
            assert.equal(res.headers.get('set-cookie'), 'foo=bar, baz=qux')
        })

        describe('passthrough', () => {
            let server
            before(next => server = createServer({keepAliveTimeout: 100}).on('request',
                (req, res) => res.end('passthrough')).listen(port, next)
            )
            after(next => server.close(next))
            beforeEach(() => options.origin = `http://localhost:${port}`)

            it('by default when no errors are thrown...', async () => {
                let res = await call()
                assert.equal(await res.text(), 'passthrough')
            })

            it('when passThroughOnException() is called', async () => {
                handlers = [ev => {
                    ev.passThroughOnException()
                    throw new Stackless('wat')
                }]
                let res = await call()
                assert.equal(await res.text(), 'passthrough')
            })

            it('when configured to fail open', async () => {
                handlers = [ev => ev.respondWith(Promise.reject(new Stackless('wat')))]
                let res = await call()
                assert.include(await res.text(), 'wat')

                options.forward = true
                res = await call()
                assert.equal(await res.text(), 'passthrough')
            })
        })
    })


    describe('compile', () => {
        let defaults = {
            require: [],
            timeout: 10
        }
        it('throws on syntax error', () => assert.throws(() =>
            compile('}', {}, defaults)
        , 'token'))

        it('throws on unhandled exception', () => assert.throws(() =>
            compile('throw new Error("blah")', {}, defaults)
        , 'blah'))

        it('throws when there are no fetch handlers', async () => {
            let out = {}
            await assert.throws(() =>
                compile('out.CF_EMU_TEST = "c"', {out}, defaults)
            , 'fetch')
            assert.equal(out['CF_EMU_TEST'], 'c')
        })

        let handler = 'addEventListener("fetch", () => {})'
        it('returns a HTTP handler', () => {
            let result = compile(handler, {}, defaults)
            assert.isFunction(result)
            assert.lengthOf(result, 2)
        })

        it('exports bindings', () => {
            let out = {}
            let x = {a: Symbol(), b: Symbol()}
            compile(`out.CF_EMU_TEST = {a, b};${handler}`, {out, ...x}, defaults)
            assert.deepEqual(out['CF_EMU_TEST'], x)
        })

        it('runs code in a sandbox', () => {
            let out = {}
            compile('Object.assign(out, this)', {out}, defaults)
            assert.containsAllKeys(out, ['setTimeout', 'addEventListener'])
            assert.doesNotHaveAnyKeys(out, ['global', 'process', 'queueMicrotask'])
        })

        it('throws on timeout', async () => {
            let out = {}
            await assert.throws(() =>
                compile('for(let i=0;;i++)out.CF_EMU_TEST = i++', {out}, defaults)
            , 'timed out')
            assert.isAbove(out['CF_EMU_TEST'], 100)
        })

        it('imports the default runtime', () => {
            let out = {}
            compile(`out.CF_EMU_TEST = Request;${handler}`, {out}, defaults)
            assert.strictEqual(out['CF_EMU_TEST'], Request)
        })

        it('imports custom runtimes', () => {
            let out = {}
            compile(`out.CF_EMU_TEST = [Request, assert];${handler}`, {out}, {
                require: ['chai',
                          './cf-emu/runtime.js',
                          './fixtures/custom_runtime.test'],
                timeout: 10
            })
            assert.deepEqual(out['CF_EMU_TEST', ['foo', assert]])
        })
    })


    describe('serve', () => {
        let input = 'addEventListener("fetch", e => e.respondWith(new Response("hello world")))'
        let worker
        let event = (event, target=worker) => new Promise(
            (res, rej) => target.on('error', err => rej(err))
                                .on(event, val => res(val)))

        beforeEach(() => worker = null)

        it('starts a http server on the configured port', async () => {
            worker = serve(input, {port, keepalive})
            await event('ready')
            let res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'hello world')
            let close = event('close')
            worker.emit('stop')
            await close
        })

        it('gracefully shuts down', async function() {
            if(MAJOR_NODE_VERSION > 18)
                return this.skip() // node>18 will RESET instead of calling the new handler
            worker = serve(input, {port, keepalive: 500})
            await event('ready')
            let req = createConnection(port),
                res = buffer.consume(req)
            await event('connect', req)
            worker.emit('stop')
            await new Promise(res => setTimeout(res, 200))
            req.end('HEAD / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n')
            res = await res
            assert(res.toString().startsWith('HTTP/1.1 503'))
            await event('close')
        })

        it('supports bindings', async () => {
            let body = [
                '--sep',
                'Content-Disposition: form-data; name="metadata"',
                '',
                JSON.stringify({body_part: 'main', bindings: [{
                    name: 'response',
                    type: 'secret_text',
                    text: 'leaking secrets'
                }]}),
                '--sep',
                'Content-Disposition: form-data; name="main"; filename="main.js"',
                'Content-Type: text/plain',
                '',
                'addEventListener("fetch", e => e.respondWith(new Response(response)))',
                '--sep--`'
            ]
            worker = serve(body.join('\r\n'), {boundary: 'sep', port, keepalive})
            await event('ready')
            let res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'leaking secrets')
            worker.emit('stop')
            await event('close')
        })

        it('throws an error when the server could not be started', async () => {
            let server = createServer({keepAliveTimeout: 0})
            await new Promise(res => server.listen(port, res))
            worker = serve(input, {port, keepalive})
            let err = await event('close')
            assert.include(err.message, 'code 1')
            await new Promise(res => server.once('close', res).close())
        })

        it('throws an error when the server is killed', async () => {
            worker = serve(input, {port, keepalive})
            await event('ready')
            worker.emit('stop')
            worker.emit('stop')
            let err = await event('close')
            assert.include(err.message, 'signal SIGKILL')
        })

        it('handles stream errors', async () => {
            worker = serve(input, {port, keepalive})
            worker.emit('stop')
            let err = await event('close')
            assert.include(err.message, 'signal SIGINT')
        })
    })
})
