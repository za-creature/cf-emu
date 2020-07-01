let {fetch, FormData, Headers} = require('./runtime')
let {buffer, stream} = require('./lib/util')
let emu = require('./index')
let {watchdog, api} = emu

let {assert} = require('chai')
let {spawn} = require('child_process')
let {createServer} = require('http')
let {relative, resolve} = require('path')


describe('index', () => {
    let port = TEST_PORT
    let wait = (target, event) => new Promise((res, rej) => target.on('error', err => rej(err))
                                                                  .on(event, val => res(val)))

    describe('watchdog', () => {
        let worker, event = name => wait(worker, name)
        beforeEach(() => worker = null)

        let options = {watchdog: true, port, delay: 0}
        it('gracefully shuts down', async function() {
            let source = 'addEventListener("fetch", ev => ev.respondWith(new Response("hi")))'
            worker = watchdog(source, options)
            await event('ready')
            let res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'hi')
            worker.emit('stop')
            assert.equal(await event('close'), 0)
            await assert.throws(() => fetch(`http://localhost:${port}`))
        })

        it('crashes if stopped before ready', async function() {
            let source = 'addEventListener("fetch", ev => ev.respondWith(new Response("hi")))'
            worker = watchdog(source, options)
            worker.emit('stop')
            assert.equal(await event('close'), 2)
        })


        it('does not restart on startup error', async function() {
            worker = watchdog('throw "dont run this, just debugging"', options)
            assert.equal(await event('close'), 2)
        })

        it('restarts on non-startup error', async function() {
            let source = 'addEventListener("fetch", ev => {' +
                'if(ev.request.url.endsWith("crash")) setTimeout(() => eval(""), 100);' +
                'ev.respondWith(new Response("hi")) })'
            worker = watchdog(source, {...options})
            await event('ready')
            let res = await fetch(`http://localhost:${port}/crash`)
            assert.equal(await res.text(), 'hi')
            await sleep(500)
            res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'hi')
            worker.emit('stop')
            assert.equal(await event('close'), 0)
        })

        it('cancels a pending restart', async function() {
            if(MAJOR_NODE_VERSION < 10)
                return this.skip()
            let source = 'addEventListener("fetch", ev => {' +
                'setTimeout(() => eval(""), 100);' +
                'ev.respondWith(new Response("hi")) })'
            worker = watchdog(source, {...options, delay: 1000})
            await event('ready')
            let res = await fetch(`http://localhost:${port}/crash`)
            assert.equal(await res.text(), 'hi')
            await sleep(500)
            worker.emit('stop')
            assert.equal(await event('close'), 3)
        })
    })


    describe('api', function() {
        let server, event = name => wait(server, name)
        it('implements token authentication', async function() {
            let old = process.env.CF_TOKEN
            try {
                process.env.CF_TOKEN = 'foo'
                server = api({api: port})
                let res = await fetch(`http://localhost:${port}`)
                assert.equal(res.status, 401)
                assert.equal(await res.text(), 'unauthorized')
                res = await fetch(`http://localhost:${port}`, {headers: {
                    authorization: 'Bearer foo'}
                })
                assert.equal(res.status, 405)
                assert.equal(await res.text(), 'method not allowed')
                server.emit('stop')
                await event('close')
            } finally {
                if(old)
                    process.env.CF_TOKEN = old
                else
                    delete process.env.CF_TOKEN
            }
        })

        it('implements api-key authentication', async function() {
            let old_email = process.env.CF_EMAIL,
                old_key = process.env.CF_APIKEY
            try {
                process.env.CF_EMAIL = 'bar'
                process.env.CF_APIKEY = 'baz'
                server = api({api: port})
                let res = await fetch(`http://localhost:${port}`)
                assert.equal(res.status, 401)
                assert.equal(await res.text(), 'unauthorized')
                let headers = new Headers() // dict rejects x-auth headers
                headers.set('x-auth-email', 'bar')
                headers.set('x-auth-key', 'baz')
                res = await fetch(`http://localhost:${port}`, {method: 'PUT',
                                                               headers})
                assert.equal(res.status, 400)
                assert.equal(await res.text(), 'bad request')
                server.emit('stop')
                await event('close')
            } finally {
                if(old_email)
                    process.env.CF_EMAIL = old_email
                else
                    delete process.env.CF_EMAIL
                if(old_key)
                    process.env.CF_APIKEY = old_key
                else
                    delete process.env.CF_APIKEY
            }
        })

        let instance
        before(() => {
            let tok = process.env.CF_TOKEN
            try {
                process.env.CF_TOKEN = 'tok'
                instance = api({port, api: API_PORT, timeout: 300})
                return wait(instance, 'ready')
            } finally {
                if(tok)
                    process.env.CF_TOKEN = tok
                else
                    delete process.env.CF_TOKEN
            }
        })
        after(() => (instance.emit('stop'), wait(instance, 'close')))
        it('deploys code from body', async function() {
            let res = await fetch(`http://localhost:${API_PORT}`, {
                headers: {
                    authorization: 'Bearer tok',
                    'content-type': 'application/javascript'
                },
                method: 'PUT',
                body: 'addEventListener("fetch", ev => ev.respondWith(new Response("worker deployed from api")))'
            })
            assert.equal(res.status, 200)
            assert.include(await res.text(), 'deployed')
            res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'worker deployed from api')
        })

        it('rejects invalid workers', async function() {
            let res = await fetch(`http://localhost:${API_PORT}`, {
                headers: {
                    authorization: 'Bearer tok',
                    'content-type': 'application/javascript'
                },
                method: 'PUT',
                body: 'BLAH()'
            })
            assert.equal(res.status, 422)
            assert.include(await res.text(), 'error')
        })

        it('rejects concurrent updates', async function() {
            let res1 = fetch(`http://localhost:${API_PORT}`, {
                headers: {
                    authorization: 'Bearer tok',
                    'content-type': 'application/javascript'
                },
                method: 'PUT',
                body: 'while(true);'
            })
            await sleep(100)
            let res2 = fetch(`http://localhost:${API_PORT}`, {
                headers: {
                    authorization: 'Bearer tok',
                    'content-type': 'application/javascript'
                },
                method: 'PUT',
                body: 'addEventListener("fetch", ev => ev.respondWith(new Response(response)))'
            })
            res1 = await res1
            assert.equal(res1.status, 422)
            assert.include(await res1.text(), 'error')

            res2 = await res2
            assert.equal(res2.status, 409)
            assert.include(await res2.text(), 'flight')
        })

        it('replaces existing workers from multipart body', async function() {
            let form = new FormData()
            form.set('metadata', JSON.stringify({body_part: 'main', bindings: [{
                name: 'response',
                type: 'plain_text',
                text: 'binding'
            }]}))
            form.set('main', 'addEventListener("fetch", ev => ev.respondWith(new Response(response)))')

            let res = await fetch(`http://localhost:${API_PORT}`, {
                headers: {
                    authorization: 'Bearer tok',
                    'content-type': `multipart/form-data; boundary='${form.getBoundary()}'`
                },
                method: 'PUT',
                body: await buffer.consume(form)
            })
            assert.include(await res.text(), 'deployed')
            res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'binding')
        })
    })


    describe('emu', () => {
        let instance, event = name => wait(instance, name)
        it('deploys from file', async function() {
            instance = emu({
                input: relative(process.cwd(),
                                resolve(__dirname, '../fixtures/simple.test.js')),
                port
            })
            await event('ready')
            let res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'hello world')
            instance.emit('stop')
            await event('close')
        })

        it('deploys from stdin', async function() {
            let source = 'addEventListener("fetch", ev => ev.respondWith(new Response("hi")))'
            let old = Object.getOwnPropertyDescriptor(process, 'stdin')
            try {
                Object.defineProperty(process, 'stdin', {
                    value: stream(source),
                    enumerable: true,
                    configurable: true
                })
                instance = emu({input: '-', port})
                await event('ready')
                let res = await fetch(`http://localhost:${port}`)
                assert.equal(await res.text(), 'hi')
                instance.emit('stop')
                await event('close')
            } finally {
                Object.defineProperty(process, 'stdin', old)
            }
        })

        it('refuses to deploy unauthenticated api by default', async function() {
            instance = emu({api: port})
            assert.equal(await event('close'), 1)
        })

        it('deploys unauthenticated api with flag', async function() {
            instance = emu({api: port, unsafe: true})
            await event('ready')
            let res = await fetch(`http://localhost:${port}`, {method: 'PUT'})
            assert.equal(await res.status, 400)
            instance.emit('stop')
            assert.equal(await event('close'), 0)
        })

        it('returns 1 if the port is already used', async function() {
            let server = createServer()
            await new Promise(res => server.listen(port, res))
            try {
                instance = emu({api: port, unsafe: true})
                assert.equal(await event('close'), 1)
            } finally {
                await new Promise(res => server.on('close', res).close())
            }
        })
    })


    describe('cli', () => {
        it('returns 1 on bad command line argument', next => {
            spawn(process.execPath,
                  [__dirname, '--foo'],
                  {stdio: 'inherit'}).once('close', (code, signal) => {
                try {
                    assert.equal(code, 1)
                    assert.isNull(signal)
                } finally {
                    next()
                }
            })
        })

        it('exits gracefully on SIGINT', next => {
            let proc = spawn(process.execPath,
                             [__dirname, `--api=${API_PORT}`, '--unsafe'],
                             {stdio: 'inherit'}).once('close', (code, signal) => {
                try {
                    assert.equal(code, 0)
                    assert.isNull(signal)
                } finally {
                    next()
                }
            })
            sleep(200).then(() => proc.kill('SIGINT'))
        })

        it('forcefully terminates worker on double SIGINT', async function() {
            this.timeout(10000)
            let proc = spawn(process.execPath,
                             [__dirname, '--port', port, '--api', API_PORT, '--unsafe',
                              resolve(__dirname, '../fixtures/blocking.test.js')],
                             {stdio: 'inherit'})
            let shutdown = new Promise(next => proc.once('close', (code, signal) => {
                assert.equal(code, 3)
                assert.isNull(signal)
                next()
            }))
            await sleep(1000)
            let req = await fetch(`http://localhost:${API_PORT}`, {
                headers: {'content-type': 'application/javascript'},
                method: 'PUT',
                body: 'addEventListener("fetch", ev => {while(true);})'
            })
            assert.equal(req.status, 200)
            req = assert.throws(() => fetch(`http://localhost:${port}`))
            await sleep(500)
            proc.kill('SIGINT')
            await sleep(1000)
            proc.kill('SIGINT')
            await req
            await shutdown
        })
    })
})
