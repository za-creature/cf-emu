#!/usr/bin/env node
let {bugs} = require('./package.json')
let cli = require('./cli')
let serve = require('./worker')
let {buffer, http_503, Thread} = require('./lib/util')

let {createReadStream} = require('fs')
let {createServer} = require('http')
let {Stream} = require('stream')


/* runs a worker and restarts it on crash; returns a thread */
function watchdog(input, options) {
    let thread = new Thread('watchdog')
    async function run() {
        let worker, last_status = 1, stop = !options.watchdog, deployed = false
        thread.on('stop', () => {
            stop = true
            if(worker)
                worker.emit('stop')
            else
                process.nextTick(() => thread.emit('close', last_status))
        })
        if(input instanceof Stream)
            input = await buffer.consume(input)
        do {
            let last = Date.now()
            let reason = await new Promise(cb => worker = serve(input, options)
                .once('ready', () => {
                    if(!deployed) {
                        deployed = true
                        thread.emit('ready')
                    }
                })
                .once('close', cb))
            worker = null, last_status = reason ? 2 + deployed : 0
            if(!deployed)
                stop = true
            if(stop) {
                // final shutdown
                console.log(reason || 'worker gracefully shut down')
                thread.emit('close', last_status)
            } else {
                // restart after an optional rate-limiting delay
                reason += '; restarting'
                let delta = Math.max(0, options.delay + last - Date.now())
                if(delta)
                    reason += ` in ${delta}ms`
                console.log(reason)
                await new Promise(res => setTimeout(res, delta))
            }
        } while(!stop)
    }
    run().catch(/*istanbul ignore next*/ err => {
        console.error('unhandled error in watchdog main loop; please report' +
                      ` this at \n${bugs.url}\n`)
        console.error(err)
        thread.emit('close', 1)
    })
    return thread
}


function api(options) {
    let worker
    let lock = false
    let handler = async (req, res) => {
        let start = Date.now()

        if(!authorized(req)) {
            res.statusCode = 401
            return res.end('unauthorized')
        }

        if(req.method != 'PUT') {
            res.statusCode = 405
            return res.end('method not allowed')
        }

        if(!req.headers['content-type']) {
            res.statusCode = 400
            return res.end('bad request')
        }

        // lock worker to this request
        if(lock) {
            res.statusCode = 409
            return res.end('another update is in flight')
        }
        lock = true
        try {
            // get multipart boundary if any, otherwise assume raw javascript
            options.boundary = undefined
            let match = req.headers['content-type'].match(/^multipart\/form-data;\s*boundary\s*=\s*"?(.+)"?\s*$/)
            if(match) {
                match = match[1].trim()
                /*istanbul ignore else*/
                if(
                        match[0] == match[match.length-1] &&
                        (match[0] == '"' || match[0] == '\''))
                    match = match.slice(1, -1)
                options.boundary = match
            }

            // shutdown previous worker, if any
            if(worker)
                await new Promise(res => worker.once('close', res).emit('stop'))

            // deploy new worker
            try {
                await new Promise((res, rej) =>
                    worker = watchdog(req, options)
                        .once('ready', res)
                        .once('close', code => (worker = null, rej(code)))
                    )
                res.statusCode = 200
                res.end(`deployed ${req.headers['content-length']>>10}KiB` +
                        ` worker in ${Date.now() - start}ms`)
            } catch(code) {
                res.statusCode = 422
                res.end(`unable to deploy worker (error code ${code})`)
            }
        } catch(err) /*istanbul ignore next*/ {
            console.error('unhandled error in api handler; please report this' +
                          ` at \n${bugs.url}\n`)
            console.error(err)
            res.statusCode = 500
            res.end('internal server error')
        } finally {
            lock = false
        }
    }

    // authorization
    const {CF_TOKEN, CF_EMAIL, CF_APIKEY} = process.env
    const {unsafe} = options
    let authorized = req => (unsafe
        || CF_TOKEN && req.headers.authorization == `Bearer ${CF_TOKEN}`
        || CF_EMAIL && CF_APIKEY && req.headers['x-auth-email'] == CF_EMAIL
                                 && req.headers['x-auth-key'] == CF_APIKEY)

    // start api server and main thread
    let thread = new Thread('api server').on('stop', () => {
        if(worker)
            worker.once('close', code => status = code).emit('stop')
        if(server) {
            server.on('request', http_503).removeListener('request', handler).close()
            server = null
        }
    })
    let status = 0
    let server = createServer({keepAliveTimeout: options.keepalive}).on('request', handler)
        .once('close', () => {
            if(worker)
                worker.once('close', status => thread.emit('close', status))
            else
                thread.emit('close', status)
        })
        .once('error', err => {
            console.error(err.stack)
            status = 1
            thread.emit('stop')
        })
        .listen(options.api, () => thread.emit('ready'))

    // force authentication
    if(!CF_TOKEN && (!CF_EMAIL || !CF_APIKEY)) {
        if(unsafe)
            console.warn('running API server without authorization')
        else {
            console.error('no authorization credentials found; please define' +
                          ' CF_TOKEN and / or CF_EMAIL + CF_APIKEY, or run' +
                          ' with --unsafe to ignore')
            status = 1
            thread.emit('stop')
        }
    }
    return thread
}


function emu(options) {
    options = cli.defaults(options)
    if(options.input) {
        let input = options.input == '-' ? process.stdin
                                         : createReadStream(options.input)
        delete options.input
        return watchdog(input, options)
    } else
        return api(options)
}


if(require.main === module) {
    let thread = emu(cli.argv).once('close', status => process.exit(status))
    process.on('SIGINT', () => {
        thread.emit('stop')
        console.log('Shutting down...')
        setTimeout(() => console.log('To force, send ^C again'), 500)
    })
} else
    module.exports = Object.assign(emu, {watchdog, api})
