let cli = require('./cli')
let {buffer, random_hex, stream, http_503} = require('./lib/util')
let {parse, piccolo} = require('./lib/multipart')

let {spawn} = require('child_process')
let {createServer} = require('http')
let {relative, resolve} = require('path')


let translate = (handlers, options) => (req, res) => {
    // translate between http.server.on('request') and self.on('fetch')
    let respond = response => {
        if(!(response instanceof Response))
            return error(new Error('invalid response type'))
        console.log(req.method, response.status, url)
        res.statusCode = response.status
        for(let [key, value] of response.headers)
            res.setHeader(key, value)
        if(response.body && typeof response.body.pipe == 'function')
            response.body.pipe(res)
                .on('finish', () => res.end())
                .on('error', /*istanbul ignore next*/err => (console.error(err.stack || err), res.end()))
        else
            response.arrayBuffer().then(buff => res.end(Buffer.from(buff)), error)
    }

    // error handling
    let passthrough = options.forward || false
    let error = err => {
        if(typeof err.stack != 'string')
            err = new Error(`invalid error type: ${err}`)
        if(passthrough) {
            passthrough = false
            console.error(err.stack)
            return fetch(new URL(req.url, options.origin), {method, headers, body})
            .then(respond, error)
        }
        respond(new Response(err.stack, {
            status: 500,
            headers: {
                'content-type': 'text/plain',
                'connection': 'close'
            }
        }))
    }

    // incoming request
    let {method} = req
    let headers = Object.assign({
        // https://support.cloudflare.com/hc/en-us/articles/200170986-How-does-Cloudflare-handle-HTTP-Request-headers-
        'cf-ipcountry': options.location,
        'cf-connecting-ip': req.socket.remoteAddress,
        'x-forwarded-for': req.socket.remoteAddress,
        'x-forwarded-proto': 'http',
        'cf-ray': `${random_hex(16)}-DEV`
    }, req.headers)
    let url = `http://${headers.host || req.socket.localAddress}${req.url}`
    let body = method != 'GET' && method != 'HEAD' ? req : null
    let request = new Request(url, {method, headers, body})
    if(!request.formData)
        request.formData = () => piccolo(headers, request.body)

    // fetch event
    let fetchEvent = {
        // https://developers.cloudflare.com/workers/reference/apis/fetch-event
        type: 'fetch',
        request,
        passThroughOnException() { passthrough = true },
        respondWith(response) {
            called = true
            if(response && response.then)
                response.then(respond, error)
            else
                respond(response)
        },
        waitUntil(promise) {
            if(promise.catch)
                promise.catch(err => console.error(
                    'unhandled exception in promise passed to' +
                    ' `waitUntil()`:\n\n' + err.stack
                ))
            else
                console.warn(`waitUntil() called with '${promise}' `
                             + 'which is not a Promise')
        }
    }

    // invoke event handlers until the first one triggers a response
    let called = false
    for(let handler of handlers) {
        try {
            handler(fetchEvent)
        } catch(err) {
            // the spec linked immediately above is unclear on how errors
            // interact with multiple handlers; to be safe, assume that the
            // entire worker is FUBAR on the first unhandled error and
            // don't call the others
            // TODO: validate this against cloudflare workers behavior
            called = true, error(err)
        }
        if(called)
            return
    }

    // no handlers triggered a response; forward to origin if possible
    if(!options.origin)
        return error(new Error('none of the registered `on(\'fetch\')`' +
                        ' handlers called `ev.respondWith()` and no origin' +
                        ' server was configured'))

    /*istanbul ignore if*/
    if(request.bodyUsed)
        return error(new Error('none of the registered `on(\'fetch\')`' +
                              ' handlers called `ev.respondWith()` but the' +
                              ' request body was already consumed by one of' +
                              ' the handlers; please report this bug here:\n\n' +
                              ' https://github.com/za-creature/cf-emu/issues\n\n'))

    passthrough = false
    console.warn(`respondWith() not called, forwarding to ${options.origin}`)
    fetch(new URL(req.url, options.origin), {method, headers, body}).then(respond, error)
}


function register(options) {
    // import custom runtimes
    for(let path of options.require || []) {
        if(path.startsWith('.')) {
            path = relative(__dirname, resolve(process.cwd(), path))
            /*istanbul ignore else*/
            if(!path.startsWith('.'))
                path = './' + path
        }
        require(path)
    }

    // export bindings
    for(let [key, val] of Object.entries(options.bindings || {}))
        global[key] = val

    // import default runtime
    let handlers = require('./runtime')
    /*istanbul ignore if*/
    if(handlers.length)
        throw new Error('bad test case: runtime already imported')

    // import code as a temporary module and translate on('fetch') handlers
    new module.constructor()._compile(options.code, `/tmp/${random_hex(12)}.js`)
    if(!handlers.length)
        throw new Error('worker did not define any on(`fetch`) handlers')
    return translate(handlers, options)
}


/* spawns a http server that serves a worker in a subprocess, and returns a
Promise that waits for it to exit, with the following additional methods:

.deployed: a Promise that resolves once the http server is running
.close(): stops the server once all outstanding requests are fulfilled
.kill(): immediately stops the server (unless kernel errors occur) */
function deploy(options) {
    // add default command line options
    options = Object.assign(cli.parse([]), options)
    let input = stream(options.input)
    delete options.input

    // port scanner
    let deploy_cb
    let deployed = new Promise((res, rej) => deploy_cb = err => err ? rej(err) : res())

    // child process
    let listen_symbol = random_hex(256)
    let worker = spawn(process.execPath,
                       [__filename, listen_symbol, JSON.stringify(options)],
                       {stdio: ['pipe', 'inherit', 'inherit', 'ipc']})
    worker.on('message', msg => msg == listen_symbol && deploy_cb())
    worker.on('exit', (code, signal) => {
        worker = null
        let reason
        if(signal !== null)
            reason = `by signal ${signal}`
        else if(code)
            reason = `with exit code ${code}`
        if(reason) {
            reason = new Error(`worker terminated ${reason}`)
            deploy_cb(reason)
            cb(reason)
        } else {
            deploy_cb(new Error('worker was shut down'))
            cb()
        }
    })
    input = stream(input)
    input.pipe(worker.stdin)

    // child process promise
    let cb
    let main = new Promise((res, rej) => cb = err => err ? rej(err) : res())

    // public interface
    let result = deployed.catch(() => {}).then(() => main)
    return Object.assign(result, {
        deployed,
        close: () => (worker && worker.kill('SIGINT'), result),
        kill: () => (worker && worker.kill('SIGKILL'), result)
    })
}


async function main() {
    try {
        // load worker
        let listen = process.argv[2]
        let options = JSON.parse(process.argv[3])
        options.bindings = {}
        if(options.boundary)
            options.code = await parse(await piccolo({
                'content-type': `multipart/form-data; boundary=${options.boundary}`
            }, process.stdin), options.bindings)
        else
            options.code = (await buffer.consume(process.stdin)).toString('utf-8')
        let handler = register(options)

        // spawn server
        await new Promise((res, rej) => {
            let server = createServer(handler)
            .on('close', res)
            .on('error', rej)
            .listen(options.port, () => {
                // graceful shutdown code:
                // stops listening for new connections, waits for requests on active
                // connections to resolve and returns 503 for future requests

                // once there are no more active connections, server will emit
                // 'close' which happens as soon as the last outstanding request has
                // completed (for well behaved clients that send 'connection: close'
                // on their last request), or after the http.server keep-alive
                // timeout expires (defaults to 5 seconds)
                process.once('SIGINT', () => server.on('request', http_503)
                                                   .off('request', handler)
                                                   .close())
                process.send(listen)
            })
        })
        process.exit(0)
    } catch(err) {
        console.error(err.stack || err)
        process.exit(1)
    }
}


if(require.main === module)
    main()
else
    module.exports = Object.assign(deploy, {translate, register})
