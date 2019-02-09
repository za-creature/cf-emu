exports.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8' }
    encode(str) { return new Uint8Array(Buffer.from(str, 'utf-8')) }
}


const SUPPORTED_LABELS = [
        ['utf-8', ['unicode-1-1-utf-8', 'utf-8', 'utf8']],
        ['utf-16le', ['utf-16', 'utf-16le']],
        ['latin1', ['ansi_x3.4-1968', 'ascii', 'cp1252', 'cp819',
                    'csisolatin1', 'ibm819', 'iso-8859-1', 'iso-ir-100',
                    'iso8859-1', 'iso88591', 'iso_8859-1',
                    'iso_8859-1:1987', 'l1', 'latin1', 'us-ascii',
                    'windows-1252', 'x-cp1252']]
    ].reduce((obj, [encoding, labels]) => {
        for(let label of labels)
            obj.set(label, encoding)
        return obj
    }, new Map())


exports.TextDecoder = class TextDecoder {
    constructor(label='utf-8', options={}) {
        if(options.fatal)
            throw new SyntaxError('{\'fatal\': true} is not supported')
        let encoding = SUPPORTED_LABELS.get(label)
        if(!encoding)
            throw new TypeError(`encoding '${label}' is not supported`)
        Object.defineProperty(this, 'encoding', {get: () => encoding})
    }
    decode(bin) { return Buffer.from(bin).toString(this.encoding) }
}


exports.Promise_allSettled = function allSettled(promises) {
    return Promise.all(promises.map(promise => promise.then(
        value => {return {status: 'fulfilled', value}},
        reason => {return {status: 'rejected', reason}}
    )))
}
