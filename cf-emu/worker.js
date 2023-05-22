let {defaults} = require('./cli')
let {buffer, http_503, random_hex, stream, Thread} = require('./lib/util')
let {parse, piccolo} = require('./lib/multipart')
let {bugs} = require('./package.json')
let {fetch, Request, Response, URL} = require('./runtime')

let {spawn} = require('child_process')
let {createServer} = require('http')
let {tmpdir} = require('os')
let {relative, resolve} = require('path')
let vm = require('vm')


/* translates one or more self.on('fetch') `handlers` (live binding) and its
   associated `options` object into a http.server.on('request') handler */
let translate = (handlers, options) => (req, res) => {
    let respond = response => {
        if(!(response instanceof Response))
            return error(new Error('invalid response type'))
        console.log(req.method, response.status, url)
        res.statusCode = response.status
        let headers = new Map()
        for(let [key, value] of response.headers) {
            let list
            headers.set(key, list = headers.get(key) || [])
            list.push(value)
        }
        for(let [key, values] of headers) {
            res.setHeader(key, values.join(', '))
        }
        if(response.body && typeof response.body.pipe == 'function')
            response.body.pipe(res)
                .on('finish', () => res.end())
                .on('error', /*istanbul ignore next*/ err => {
                    console.error('unhandled error in translate body pipe;' +
                                  ` please report this at \n${bugs.url}\n`)
                    console.error(err)
                    res.end()
                })
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
            return fetch(new URL(req.url, options.origin), opts)
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
    let headers = {
        // https://support.cloudflare.com/hc/en-us/articles/200170986-How-does-Cloudflare-handle-HTTP-Request-headers-
        ...req.headers,
        'cf-ipcountry': options.location,
        'cf-connecting-ip': req.socket.remoteAddress,
        'x-forwarded-for': req.socket.remoteAddress,
        'x-forwarded-proto': 'http',
        'cf-ray': `${random_hex(16)}-DEV`,
    }
    let url = `http://${headers.host || req.socket.localAddress}${req.url}`
    let opts = {method, headers}
    if(method != 'GET' && method != 'HEAD') {
        opts.body = req
        opts.duplex = 'half'
    }
    let request = new Request(url, opts)
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
                console.warn(`\`waitUntil()\` called with '${promise}' `
                             + 'which is not a Promise')
        }
    }

    // invoke event handlers until the first one triggers a response
    let called = false
    for(let handler of handlers) {
        try {
            handler(fetchEvent)
        } catch(err) {
            // the first spec linked above is unclear on how errors interact
            // with multiple handlers; to be safe, assume that the whole worker
            // is FUBAR on the first unhandled error and don't call the others
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
        return error(new Error('none of the registered `on(\'fetch\')` handlers' +
                              ' called `ev.respondWith()` but the request body' +
                              ' was already consumed by one of the handlers;' +
                              ` please report this at \n${bugs.url}\n`))

    passthrough = false
    console.warn(`\`respondWith()\` not called; forwarding to ${options.origin}`)
    fetch(new URL(req.url, options.origin), opts).then(respond, error)
}


/* evaluates a `code` fragment in the worker environment defined by `options`
   and returns a http.server.on('request')-compatible handler
   WARNING: this functions taints the process with user code and should only
   be called ONCE per process */
function compile(code, globals, options) {
    // import default runtime and export the non-sandboxed console
    let ctx = Object.assign(require('./runtime'), {console})
    let {handlers} = ctx
    delete ctx.handlers

    // import custom runtimes
    for(let path of options.require) {
        if(path.startsWith('.')) {
            path = relative(__dirname, resolve(process.cwd(), path))
            if(!path.startsWith('.'))
                path = './' + path
        }
        Object.assign(ctx, require(path))
    }

    // export bindings
    Object.assign(ctx, globals)

    // evaluate worker code in sandbox
    ctx = vm.createContext(ctx, {codeGeneration: {strings: false,
                                                  wasm: false}})
    vm.runInContext(code, ctx, {filename: `${tmpdir()}/${random_hex(12)}.js`,
                                timeout: options.timeout,
                                breakOnSigint: true})

    // translate on('fetch') handlers
    if(!handlers.length)
        throw new Error('worker did not define any `on(`fetch`)` handlers')
    return translate(handlers, options)
}


/* spawns http-server connected to a worker in a subprocess; returns a thread */
function serve(input, options) {
    // add default command line options
    options = defaults(options)
    let symbol = random_hex(256)

    // spawn child process with user provided code and options
    let config = JSON.stringify(Object.assign({symbol}, options))
    let worker = spawn(process.execPath, [__filename], {
                       env: {_: Buffer.from(config).toString('base64')},
                       stdio: ['pipe', 'inherit', 'inherit', 'ipc']})
    worker.on('message', msg => msg == symbol && thread.emit('ready'))
    worker.on('close', (code, signal) => {
        worker = null
        let reason
        if(signal !== null)
            reason = `by signal ${signal}`
        else if(code)
            reason = `with exit code ${code}`
        else /*istanbul ignore if*/ if(!stop)
            reason = `prematurely; please report this at \n${bugs.url}\n`
        if(reason)
            reason = new Error(`worker terminated ${reason}`)
        thread.emit('close', reason)
    })
    stream(input).pipe(worker.stdin).on('error', err => {
        console.error(err.stack)
        thread.emit('stop')
    })

    // public interface
    let thread = new Thread('worker'), stop = false
    return thread.on('stop', () => {
        worker && worker.kill(stop ? 'SIGKILL' : 'SIGINT')
        stop = true
    })
}


/* this runs in the subprocess spawned by deploy */
async function main() {
    try {
        // load worker
        let options = JSON.parse(Buffer.from(process.env._, 'base64'))
        delete process.env._
        let bindings = {}
        let count = 0
        process.stdin.on('data', chunk => count += chunk.length)
        let code = options.boundary
            ? await parse(await piccolo({
                'content-type': `multipart/form-data; boundary=${options.boundary}`
            }, process.stdin), bindings)
            : (await buffer.consume(process.stdin)).toString('utf-8')
        let handler = compile(code, bindings, options)

        // spawn server
        await new Promise((res, rej) => {
            let server = createServer({keepAliveTimeout: options.keepalive}, handler)
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
                process.on('SIGINT', () => server.on('request', http_503)
                                                 .removeListener('request', handler)
                                                 .close())
                process.send(options.symbol)
            })
        })
        process.exit(0)
    } catch(err) {
        console.error(err)
        process.exit(1)
    }
}


if(require.main === module)
    main()
else
    module.exports = Object.assign(serve, {translate, compile})
