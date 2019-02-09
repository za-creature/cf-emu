let {buffer, stream} = require('./lib/util')
let emu = require('./index')
let {watchdog, api} = emu

let {assert} = require('chai')
let {relative, resolve} = require('path')
let {spawn} = require('child_process')


describe('index', () => {
    let port = Number(process.env.TEST_PORT)
    let proc_delay = 1000


    describe('watchdog', () => {
        let options = {watchdog: true, port}
        it('does not restart on normal exit', async () => {
            let source = 'addEventListener("fetch", ev => ev.respondWith(new Response("hi")))'
            let worker = watchdog(source, options)
            await new Promise(res => setTimeout(res, proc_delay))
            let res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'hi')
            await worker.close()
            await assert.throws(() => fetch(`http://localhost:${port}`))
            await worker.close() // should be safe to call multiple times
        })

        it('does not restart on startup error', async () => {
            let source = 'throw "dont run this, just debugging"'
            let worker = watchdog(source, options)
            await worker
        })

        it('restarts on error', async function () {
            this.timeout(5e3)
            let source = `addEventListener("fetch",
                          ev => (ev.respondWith(new Response("hi")),
                                 setTimeout(() => process.exit(4), ${proc_delay / 2})))`
            let worker = watchdog(source, options)
            await new Promise(res => setTimeout(res, proc_delay))
            let res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'hi')
            await new Promise(res => setTimeout(res, proc_delay * 3 / 2))
            res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'hi')
            await new Promise(res => setTimeout(res, proc_delay))
            await assert.throws(() => fetch(`http://localhost:${port}`))
            await worker.close()
        })
    })


    describe('api', () => {
        it('implements token authentication', async () => {
            let promise, old = process.env.CF_TOKEN
            try {
                process.env.CF_TOKEN = 'foo'
                promise = api({api: port})
                let res = await fetch(`http://localhost:${port}`)
                assert.equal(res.status, 401)
                assert.equal(await res.text(), 'unauthorized')
                res = await fetch(`http://localhost:${port}`, {headers: {
                    authorization: 'Bearer foo'}
                })
                assert.equal(res.status, 405)
                assert.equal(await res.text(), 'method not allowed')
                await promise.close()
            } finally {
                if(old)
                    process.env.CF_TOKEN = old
                else
                    delete process.env.CF_TOKEN
            }
        })

        it('implements api-key authentication', async () => {
            let promise, old_email = process.env.CF_EMAIL,
                         old_key = process.env.CF_APIKEY
            try {
                process.env.CF_EMAIL = 'bar'
                process.env.CF_APIKEY = 'baz'
                promise = api({api: port})
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
                await promise.close()
                await promise.close()  // should be safe to call multiple times
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
                instance = api({port, api: Number(process.env.API_PORT)})
                return new Promise(res => setTimeout(res, proc_delay / 5))
            } finally {
                if(tok)
                    process.env.CF_TOKEN = tok
                else
                    delete process.env.CF_TOKEN
            }
        })
        after(() => instance.close())
        it('deploys new code', async () => {
            let res = await fetch(`http://localhost:${process.env.API_PORT}`, {
                headers: {
                    authorization: 'Bearer tok',
                    'content-type': 'application/javascript'
                },
                method: 'PUT',
                body: 'addEventListener("fetch", ev => ev.respondWith(new Response("worker deployed from api")))'
            })
            assert(await res.text() == 'deployed')
            await new Promise(res => setTimeout(res, proc_delay))
            res = await fetch(`http://localhost:${port}`)
            await res
            assert.equal(await res.text(), 'worker deployed from api')
        })

        it('replaces existing workers', async () => {
            let form = new FormData()
            form.set('metadata', JSON.stringify({body_part: 'main', bindings: [{
                name: 'response',
                type: 'plain_text',
                text: 'binding'
            }]}))
            form.set('main', 'addEventListener("fetch", ev => ev.respondWith(new Response(response)))')

            let res = await fetch(`http://localhost:${process.env.API_PORT}`, {
                headers: {
                    authorization: 'Bearer tok',
                    'content-type': `multipart/form-data; boundary='${form.getBoundary()}'`
                },
                method: 'PUT',
                body: await buffer.consume(form)
            })
            assert(await res.text() == 'deployed')
            await new Promise(res => setTimeout(res, proc_delay))
            res = await fetch(`http://localhost:${port}`)
            await res
            assert.equal(await res.text(), 'binding')
        })
    })


    describe('emu', () => {
        it('deploys from file', async () => {
            let promise = emu({
                input: relative(process.cwd(),
                                resolve(__dirname, 'fixtures/simple.test.js')),
                port
            })
            await new Promise(res => setTimeout(res, proc_delay))
            let res = await fetch(`http://localhost:${port}`)
            assert.equal(await res.text(), 'hello world')
            await promise.close()
        })

        it('deploys from stdin', async () => {
            let source = 'addEventListener("fetch", ev => ev.respondWith(new Response("hi")))'
            let proc = spawn(process.execPath,
                             [resolve(__dirname, 'fixtures/emu_stdin.test.js')],
                             {stdio: ['pipe', 'inherit', 'inherit']})

            let code, signal, done
            try {
                stream(source).pipe(proc.stdin)
                done = new Promise(res => proc.once('exit', (stat, sig) => {
                    code = stat
                    signal = sig
                    res()
                }))

                // worker is deployed
                await new Promise(res => setTimeout(res, proc_delay))
                let res = await fetch(`http://localhost:${port}`)
                assert.equal(await res.text(), 'hi')
            } finally {
                proc.kill('SIGINT')
                await done
                assert.equal(code, 0)
                assert.isNull(signal)
            }
        })

        it('refuses to deploy unauthenticated without --unsafe', async () => {
            let proc = spawn(process.execPath,
                             [resolve(__dirname), '--api',
                              process.env.TEST_PORT],
                             {stdio: ['inherit', 'inherit', 'inherit']})
            let code
            await new Promise(res => proc.once('exit', c => (res(), code = c)))
            assert.equal(code, 1)
        })

        it('deploys unauthenticated api with --unsafe', async () => {
            let proc = spawn(process.execPath,
                             [resolve(__dirname), '--api',
                              process.env.TEST_PORT, '--unsafe'],
                             {stdio: ['inherit', 'inherit', 'inherit']})

            let code, signal, done
            try {
                done = new Promise(res => proc.once('exit', (stat, sig) => {
                    code = stat
                    signal = sig
                    res()
                }))
                // api is deployed
                await new Promise(res => setTimeout(res, proc_delay))
                let res = await fetch(`http://localhost:${port}`, {method: 'PUT'})
                assert.equal(await res.status, 400)
            } finally {
                proc.kill('SIGINT')
                await done
                assert.equal(code, 0)
                assert.isNull(signal)
            }
        })
    })


    describe('cli', () => {
        it('returns 1 on bad command line argument', next => {
            let proc = spawn(process.execPath,
                             [__dirname, '--foo'],
                             {stdio: 'ignore'})
            proc.once('exit', (code, signal) => {
                try {
                    assert.equal(code, 1)
                    assert.isNull(signal)
                } finally {
                    next()
                }
            })
        })

        it.skip('supports multipart from stdin',  next => {
            next()
        })

        it.skip('exits gracefully', () => {

        })
    })
})
