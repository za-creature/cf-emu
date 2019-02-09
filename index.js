#!/usr/bin/env node
let cli = require('./cli')
let deploy = require('./worker')
let {buffer, http_503} = require('./lib/util')

let {createReadStream} = require('fs')
let {createServer} = require('http')


function watchdog(input, options, restart_delay=5000) {
    let worker, last = 0, schedule = null
    let redeploy = () => {
        schedule = null
        if(worker) {
            // finish watchdog log and maybe rate-limit
            try {
                process.stdout.write('restarting')
                let delta = restart_delay + last - Date.now()
                if(delta > 0) {
                    process.stdout.write(` in ${delta}ms`)
                    worker = null
                    return schedule = setTimeout(redeploy, delta)
                }
            } finally {
                console.log()
            }
        }
        let deployed = false
        worker = deploy(Object.assign(options, {input}))
        worker.deployed.then(() => deployed = true).catch(() => {})
        worker.then(() => (worker = null, cb(0))).catch(err => {
            // log error and maybe start watchdog log
            process.stdout.write(err.message)
            if(options.watchdog && worker && deployed) {
                process.stdout.write(', ')
                redeploy()
                last = Date.now()
            }
            else
                console.log(), cb(2 + deployed)
        })
    }
    Promise.resolve(input).then(data => ((input = data), redeploy()))

    let cb
    let result = new Promise(res => cb = res)
    return Object.assign(result, {
        close: () => {
            if(worker)
                worker.close()
            else if(schedule) {
                clearTimeout(schedule)
                schedule = null
                cb(0)
            }
            return result
        },
        kill: () => {
            options.redeploy = false
            if(worker)
                worker.kill()
            else if(schedule) {
                clearTimeout(schedule)
                schedule = null
                cb(3)
            }
            return result
        }
    })
}


function api(options) {
    // ensure just one request at a time
    let lock
    let handler = async (req, res) => {
        if(lock)
            await lock
        let unlock
        lock = new Promise(res => unlock = res)

        try {
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

            // shut down existing worker if any
            let previous = Promise.resolve()
            if(worker)
                previous = worker.close()
            let code = buffer.consume(req)

            //figure out whether bindings are included and deploy
            let match = req.headers['content-type'].match(/^multipart\/form-data;\s*boundary\s*=\s*"?(.+)"?\s*$/)
            if(match) {
                match = match[1].trim()
                /*istanbul ignore else*/
                if(
                        match[0] == match[match.length-1] &&
                        (match[0] == '"' || match[0] == '\''))
                    match = match.slice(1, -1)
                options.boundary = match
            } else
                options.boundary = undefined
            await previous
            worker = watchdog(code, options)
            res.statusCode = 200
            res.end('deployed')
        } catch(err) /*istanbul ignore next*/{
            console.log(err.stack || err)
            res.statusCode = 500
            res.end('internal server error')
        } finally {
            unlock()
        }
    }
    let worker = null

    // authorization
    const {CF_TOKEN, CF_EMAIL, CF_APIKEY} = process.env
    const {unsafe} = options
    let authorized = req => (unsafe
        || CF_TOKEN && req.headers.authorization == `Bearer ${CF_TOKEN}`
        || CF_EMAIL && CF_APIKEY && req.headers['x-auth-email'] == CF_EMAIL
                                 && req.headers['x-auth-key'] == CF_APIKEY)
    let server, result = new Promise((res, rej) => {
        if(!CF_TOKEN && (!CF_EMAIL || !CF_APIKEY)) {
            if(unsafe)
                console.warn('running API server without authorization')
            else
                throw new Error('no authorization credentials found; please' +
                                ' define CF_TOKEN and / or CF_EMAIL +' +
                                ' CF_APIKEY, or run with --unsafe to ignore')
        }

        // start server
        server = createServer(handler)
        .on('close', () => res(code))
        .on('error', rej)
        .listen(options.api)
    }).then(() => worker).then(Promise.resolve(0))
    let code = 0
    return Object.assign(result, {
        close: () => {
            if(server)
                server.on('request', http_503).off('request', handler).close()
            server = null
            if(worker)
                worker.close()
        },
        kill: () => {
            if(server)
                server.on('request', http_503).off('request', handler).close()
            server = null
            if(worker)
                worker.kill()
            code = 3
        }
    })
}


function emu(options) {
    options = Object.assign(cli.parse([]), options)
    if(options.input)
        return watchdog(options.input != '-' ? createReadStream(options.input)
                                             : process.stdin, options)
    else
        return api(options)
}


if(require.main === module) {
    let promise = emu(cli.argv)
    process.once('SIGINT', () => {
        process.once('SIGINT', promise.kill)
        console.log('Shutting down...')
        setTimeout(() => console.log('To force, send ^C again'), 500)
        promise.close()
    })
    promise.then(code => process.exit(code))
           .catch(/*istanbul ignore next*/
                  err => (console.error(err.stack), process.exit(1)))
}
else
    module.exports = Object.assign(emu, {watchdog, api})
