let deploy = require('./worker')
let {translate, register} = deploy
let {Stackless, buffer, stream} = require('./lib/util')

let {assert} = require('chai')
let {createServer} = require('http')
let {createConnection} = require('net')
let {relative, resolve} = require('path')


describe('server', () => {
    let port = Number(process.env.TEST_PORT)
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
            res.setHeader = (key, val) => (headers[key] = val, undefined)
            Object.defineProperty(res, 'statusCode', {
                get() { return status },
                set(val) { status = val }
            })
            translate(handlers, options)(req, res)
            return res.promise.then(body => new Response(body, {status, headers}))
        }

        it('forwards method, url and headers', async () => {
            let req
            handlers = [e => {
                req = e.request
                e.respondWith(new Response('', {status: 204, headers: {baz: 'qux'}}))
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

        it('implements request.formData()', async () => {
            let promise
            handlers = [e => (promise = e.request.formData(), e.respondWith(''))]
            await call({
                method: 'POST',
                body: 'foo=bar&baz=qux',
                headers: {'content-type': 'application/x-www-form-urlencoded'}
            })
            assert.isFunction(promise.then)
            let data = await promise
            assert.equal(data.get('foo'), 'bar')
            assert.equal(data.get('baz'), 'qux')

            await call()
            assert.deepEqual(Array.from((await promise).entries()), [])
        })

        it('conditionally implements formData()', async () => {
            let old = Request.prototype.formData
            try {
                Request.prototype.formData = async () => 'foo'
                let promise
                handlers = [e => (promise = e.request.formData(), e.respondWith(''))]
                await call({
                    method: 'POST',
                    body: 'foo=bar&baz=qux',
                    headers: {'content-type': 'application/x-www-form-urlencoded'}
                })
                assert.equal(await promise, 'foo')
            } finally {
                if(old)
                    Request.prototype.formData = old
                else
                    delete Request.prototype.formData
            }
        })

        it('implements non-blocking event.waitUntil()', async () => {
            let delayed = false
            let timer = new Promise(res => setTimeout(res, 20)).then(() => {
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
            before(next => server = createServer(
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


    describe('register', () => {
        let handler = 'addEventListener("fetch", () => {})'
        let runtime = require.resolve('./runtime'), old = require.cache[runtime]
        beforeEach(() => delete require.cache[runtime])
        after(() => require.cache[runtime] = old)

        it('imports the module and returns a HTTP handler', () => {
            let result = register({code: `global.CF_EMU_TEST = 'a';${handler}`})
            assert.equal(global['CF_EMU_TEST'], 'a')
            assert.isFunction(result)
            assert.equal(result.length, 2)
        })

        it('imports custom runtimes', () => {
            register({
                code: `global.CF_EMU_TEST = Request;${handler}`,
                require: ['chai', './' + relative(process.cwd(),
                    resolve(__dirname, 'fixtures/custom_runtime.test'),
                )]
            })
            assert.equal(global['CF_EMU_TEST', 'foo'])
        })

        it('exports bindings', async () => {
            let bindings = {a: Symbol(), b: Symbol()}
            register({code: `global.CF_EMU_TEST = {a, b};${handler}`, bindings})
            assert.deepEqual(global['CF_EMU_TEST'], bindings)
            assert.include(global, bindings)
        })

        it('imports the default runtime', () => {
            let old = global.Request
            delete global.Request
            try {
                register({code: handler})
                assert.isFunction(global.Request)
            } finally {
                global.Request = old
            }
        })

        it('throws on syntax error', () => assert.throws(
            () => register({code: 'wat('})
        , SyntaxError))

        it('throws on unhandled exception', () => assert.throws(
            () => register({code: 'throw new Error("blah")'})
        , 'blah'))

        it('throws when there are no fetch handlers', async () => {
            await assert.throws(() => register({
                code: 'global.CF_EMU_TEST = "c"'
            }), 'define')
            assert.equal(global['CF_EMU_TEST'], 'c')
        })
    })


    describe('deploy', () => {
        let input = 'addEventListener("fetch", e => e.respondWith(new Response("hello world")))'
        let worker
        beforeEach(() => worker = null)
        //afterEach(() => worker && worker.kill().catch(() => {}))

        it('starts a http server on the configured port', async () => {
            worker = deploy({input, port})
            await worker.deployed
            let res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'hello world')
            await worker.close()
            worker = null
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
            worker = deploy({input: body.join('\r\n'), boundary: 'sep', port})
            await worker.deployed
            let res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'leaking secrets')
            await worker.close()
            worker = null
        })

        it('gracefully shuts down on SIGINT', async () => {
            worker = deploy({input, port})
            await worker.deployed
            let req = createConnection(port),
                res = buffer.consume(req)
            await new Promise((res, rej) => req.once('connect', res)
                                               .once('error', rej))
            assert.equal(worker.close(), worker)
            await new Promise(res => setTimeout(res, 25))
            req.end('HEAD / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n')
            res = await res
            assert(res.toString().startsWith('HTTP/1.1 503'))
            await worker
            worker = null
        })

        it('throws an error when the server could not be started', async () => {
            let server = createServer(() => {})
            try {
                await new Promise(res => server.listen(port, res))
                await assert.throws(() => deploy({input, port}), 'code 1')
            } finally {
                await new Promise(res => server.close(res))
            }
        })

        it('throws an error when the server is killed', async () => {
            worker = deploy({input, port})
            await worker.deploy
            await assert.throws(() => worker.kill(), 'signal SIGKILL')
            worker = null
        })
    })
})
