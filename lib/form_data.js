let BaseFormData = require('form-data')


let mutate = form => {if(form._used) throw new TypeError('FormData already used')}
module.exports = class FormData extends BaseFormData {
    constructor() {
        super()
        this._used = false
        this._map = new Map()
        this._files = new Map()
    }
    // FormData interface
    append(name, value, filename) {
        mutate(this)
        let values = this._map.get(name) || []
        let files = this._files.get(name) || []
        values.push(value)
        files.push(filename || value && value.name || undefined)
        this._map.set(name, values)
        this._files.set(name, files)
    }
    delete(name) {
        mutate(this)
        return this._map.delete(name)
    }
    *entries() {
        for(let name of this._map.keys())
            for(let value of this._map.get(name))
                yield [name, value]
    }
    get(name) {
        let list = this.getAll(name)
        return list.length && list[0] || null
    }
    getAll(name) {
        return this._map.get(name) || []
    }
    has(name) {
        return this._map.has(name)
    }
    keys() {
        return this._map.keys()
    }
    set(name, value, filename) {
        mutate(this)
        this._map.set(name, [value])
        this._files.set(name, [filename || value && value.name || undefined])
    }
    *values() {
        for(let name of this._map.keys())
            for(let value of this._map.get(name))
                yield value
    }


    /*
    this object inherits from stream (version 1[^1]) so flush all data before
    switching from neutral to flowing mode for the first time[^2]

    the object also becomes immutable after this step, because like all streams,
    it can only be consumed once

    to work around this limitation, use `tee()` which all node streams implement

    [^1]: https://nodejs.org/api/stream.html#stream_readable_wrap_stream
    [^2]: https://nodejs.org/api/stream.html#stream_two_reading_modes
    */
    resume() {
        this._used = true
        for(let key of this._map.keys()) {
            let i = 0
            let files = this._files.get(key)
            for(let value of this._map.get(key))
                BaseFormData.prototype.append.call(this, key, value, files[i++])
        }
        return super.resume.apply(this, arguments)
    }
    pipe() {
        setImmediate(() => this.resume())
        return super.pipe.apply(this, arguments)
    }
    on() {
        if(arguments[0] == 'data')
            setImmediate(() => this.resume())
        return super.on.apply(this, arguments)
    }
    /*istanbul ignore next*/read() {
        this.resume()
        return super.read.apply(this, arguments)
    }
}
