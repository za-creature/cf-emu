let {randomFillSync} = require('crypto')
let EventEmitter = require('events')
let {Readable, Writable} = require('stream')


exports.Stackless = class Stackless extends Error {
    constructor(message) {
        super(message)
        this.name = this.constructor.name
        this.message = message
        this.stack = `${this.name}: ${message}`
    }
}


exports.random_hex = function random_hex(length) {
    return randomFillSync(Buffer.alloc(length>>1)).toString('hex')
}


let pad = i => (i < 10 && '0' || '') + i
let weekdays = ['Sun,', 'Mon,', 'Tue,', 'Wed,', 'Thu,', 'Fri,', 'Sat,', 'Sun,']
let months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec',]
exports.http_date = function http_date(d) {
    d = new Date(d || Date.now())
    return [
        weekdays[d.getUTCDay()],
        pad(d.getUTCDate()),
        months[d.getUTCMonth()],
        d.getUTCFullYear(),
        [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(pad).join(':'),
        'GMT'
    ].join(' ')
}


exports.buffer = function buffer(split=false) {
    let buffers = []
    let result = new Writable()
    result._write = (buffer, encoding, cb) => (buffers.push(buffer), cb())
    result.promise = new Promise((res, rej) => {
        result.once('finish', () => res(split ? buffers : Buffer.concat(buffers)))
        result.once('error', rej)
    })
    result.consume = stream => {
        stream.pipe(result)
        return result.promise
    }
    return result
}
exports.buffer.consume = stream => exports.buffer().consume(stream)


exports.stream = function stream(buffer) {
    let res = new Readable()
    //res._read = () => {}
    if(buffer)
        res.push(buffer)
    res.push(null)
    return res
}


exports.http_503 = (req, res) => {
    res.statusCode = 503
    res.setHeader('connection', 'close')
    res.setHeader('content-type', 'text/plain')
    res.end('server is shutting down')
}


const NAME = Symbol()
const STATE = Symbol()
exports.Thread = class Thread extends EventEmitter {
    /* An event emitter that defines the following events:

    * 'ready': [at most once] emitted by itself once the async operation
               described by the constructor has been successfuly completed
    * 'close': [exactly once] emitted by itself to inform listeners that no
               further events will be emitted
    * 'stop':  [optional] emitted by any interested party to inform the thread
               that it should emit a 'close' event as soon as possible;
               conventionally, the first call is informative (graceful shutdown)
               and subsequent calls are more autoritative (SIGKILL imminent)
    * 'error': [optional] emitted by itself to signal an error condition; this
               can happen at any time before 'close' and unless listeners are
               registered, the process will exit (default node.js behavior);
               note that errors are not necessarily fatal if handled and,
               unless specifically documented otherwise, have no impact on
               thread state or delivery of future events (including 'error')

    At any given time, a thread is in one of the following states:
    * 'pending':  the initial state upon thread construction and before the
                  'ready' event is triggered
    * 'running':  the main thread state, between the 'ready' and 'close' events
    * 'stopping': the thread state between the 'stop' and 'close' events
    * 'closed':   the final state entered into after the 'close' event is
                  emitted; no further events will be emitted from this point on
    */
    constructor(name) {
        super()
        this[NAME] = name
        this[STATE] = 'pending'
    }
    emit(event) {
        if(this[STATE] == 'closed')
            throw new TypeError(`${this} cannot emit '${event}'`)

        if(event == 'ready') {
            if(this[STATE] != 'pending')
                throw new TypeError(`${this} cannot emit '${event}'`)
            this[STATE] = 'running'
        } else if(event == 'stop')
            this[STATE] = 'stopping'
        else if(event == 'close')
            this[STATE] = 'closed'
        return super.emit.apply(this, arguments)
    }
    toString() {
        let name = this.constructor.name
        if(this[NAME])
            name += ` '${this[NAME]}'`
        return `[${name} - ${this[STATE]}]`
    }
}
