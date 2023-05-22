/* global WebAssembly:false */
let {FormData} = require('../runtime')
let {buffer} = require('./util')

let Busboy = require('busboy')


// these belong to runtime.js, but they are intentionally not exposed in order
// to mirror CF behavior: instances are available as results of formData().get()
let Blob = exports.Blob = global.Blob || require('fetch-blob')
let File = exports.File = global.File || buffer.File || class File extends Blob {
    constructor(parts, name, options={}) {
        let lastModified
        if(options.lastModified) {
            lastModified = options.lastModified
            delete options.lastModified
        } else
            lastModified = Date.now()
        super(parts, options)
        this._lm = lastModified
        this._name = name
    }
    get lastModified() {
        return this._lm
    }
    get lastModifiedDate() {
        return new Date(this._lm)
    }
    get name() {
        return this._name
    }
}


// parses a multpart body that contains the worker and bindings; input should
// be the same as what you send to cloudflare when uploading a worker with
// bindings
exports.parse = async function parse(form, out_bindings) {
    let type, metadata = form.get('metadata')
    if(!metadata)
        throw new Error('multipart body does not contain \'metadata\' part')
    if(metadata instanceof File)
        metadata = await metadata.text()
    metadata = JSON.parse(metadata)
    let {body_part, bindings} = metadata
    if((type = typeof body_part) != 'string')
        throw new Error(`invalid metadata: 'body_part' must be a string, got ${type}`)
    if(!form.has(body_part))
        throw new Error(`invalid request: part '${body_part}' referenced` +
                        ' by metadata.body_part not present')
    if(bindings && !Array.isArray(bindings))
        throw new Error(`invalid metadata: 'bindings' must be an array, got ${typeof bindings}`)
    for(let binding of bindings || []) {
        if(!binding || typeof binding != 'object')
            throw new Error(`invalid binding, expecting object, got: ${binding}`)
        let debug = JSON.stringify(binding)
        if(!binding.name)
            throw new Error(`got binding without a 'name': ${debug}'`)
        for(let prop of ['name', 'text', 'part', 'namespace_id'])
            if((type = typeof binding[prop]) != 'undefined' && type != 'string')
                throw new Error(`binding ${prop} must be string: ${debug}`)
        let value
        if((type = binding.type) == 'plain_text' || type == 'secret_text') {
            if(!binding.text)
                throw new Error(`got text binding without a 'text': ${debug}`)
            value = binding.text
        } else if(binding.type == 'kv_namespace') {
            if(!binding.namespace_id)
                throw new Error(`got kv binding without a 'namespace_id': ${debug}`)
            console.warn('KV namespaces are currently not implemented')
        } else if(binding.type == 'wasm_module') {
            if(!binding.part)
                throw new Error(`got wasm binding without a 'part': ${debug}`)
            if(!form.has(binding.part))
                throw new Error(`invalid request: part '${body_part}'` +
                                ` referenced by ${debug} not present`)
            value = await WebAssembly.compile(await form.get(binding.part).arrayBuffer())
        } else if(binding.type == 'text_blob') {
            // these binding types are not specified and, as of 2020-06-01 are
            // not even recognized on the frontend (this means that using
            // `text_blob` bindings in your worker will effectively disable the
            // live code editor); since it's unclear what these are intended to
            // be (they seem to be linked to namespace manifests, and `bliss``
            // uses one to optionally store a base128 encoded asset archive),
            // ignore this binding if the `part` is missing, as that is the
            // only functionality that is proven to be implemented upstream
            /*istanbul ignore else*/
            if(binding.part) {
                if(!form.has(binding.part))
                    throw new Error(`invalid request: part '${body_part}'` +
                                    ` referenced by ${debug} not present`)
                value = form.get(binding.part)
                if(value instanceof Blob)
                    value = await value.text()
            }
        } else
            throw new Error(`unknown binding type: ${binding.type}`)
        out_bindings[binding.name] = value
    }
    let body = form.get(body_part)
    if(body instanceof Blob)
        body = await body.text()
    return body
}


// used to patch Request.prototype.formData() and by the API server
exports.piccolo = async function piccolo(headers, body) {
    let result = new FormData()
    if(body) {
        let files = []
        await new Promise((res, rej) => {
            let parser = new Busboy({'headers': headers, 'limits': {'fieldSize': Infinity}})
            parser.on('file', (name, stream, filename, _, type) => files.push(
                buffer(true).consume(stream).then(parts => result.append(
                    name,
                    new File(parts, filename, {type}),
                    filename
                ))
            ))
            parser.on('field', (name, val) => result.append(name, val))
            parser.on('finish', res)
            parser.on('error', rej)
            body.pipe(parser)
        })
        await Promise.all(files)
    }
    return result
}
