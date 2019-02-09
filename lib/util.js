let {Readable, Stream, Writable} = require('stream')
let {randomFillSync} = require('crypto')


module.exports.Stackless = class Stackless extends Error {
    constructor(message) {
        super(message)
        this.name = this.constructor.name
        this.message = message
        this.stack = `${this.name}: ${message}`
    }
}


module.exports.random_hex = function random_hex(length) {
    let buffer = new Uint8Array(length>>1)
    randomFillSync(buffer)
    return [].map.call(buffer, x => `00${x.toString(16)}`.slice(-2)).join('')
}


let pad = i => (i < 10 && '0' || '') + i
let weekdays = ['Sun,', 'Mon,', 'Tue,', 'Wed,', 'Thu,', 'Fri,', 'Sat,', 'Sun,']
let months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec',]
module.exports.http_date = function http_date(d) {
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


module.exports.buffer = function buffer(split=false) {
    let buffers = []
    let result = new Writable()
    result._write = (buffer, encoding, cb) => (buffers.push(buffer), cb())
    result.promise = new Promise((res, rej) => {
        result.on('finish', () => res(split ? buffers : Buffer.concat(buffers)))
        result.on('error', rej)
    })
    result.consume = stream => {
        stream.pipe(result)
        return result.promise
    }
    return result
}
module.exports.buffer.consume = stream => module.exports.buffer().consume(stream)


module.exports.stream = function stream(buffer) {
    if(buffer instanceof Stream)
        return buffer
    let res = new Readable()
    //res._read = () => {}
    if(buffer)
        res.push(buffer)
    res.push(null)
    return res
}


module.exports.http_503 = (req, res) => {
    res.statusCode = 503
    res.setHeader('connection', 'close')
    res.setHeader('content-type', 'text/plain')
    res.end('server is shutting down')
}