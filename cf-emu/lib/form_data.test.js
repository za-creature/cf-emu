let FormData = require('./form_data')
let {buffer} = require('./util')

let {assert} = require('chai')


describe('FormData', () => {
    it('constructor', () => {
        assert.isFunction(FormData)
        let data = new FormData()
        assert.instanceOf(data, FormData)
        for(let proto of ['on', 'pipe', 'resume'])
            assert.isFunction(data[proto])
    })
    it('is a one-time-use readable stream', async () => {
        let data = new FormData()
        data.append('foo', 'bar')
        data.set('baz', 'qux')
        assert.equal(data.get('foo'), 'bar')
        await buffer.consume(data)
        assert.deepEqual(data.getAll('baz'), ['qux'])
        await assert.throws(() => data.append('qux', 'foo'), 'used')
        await assert.throws(() => data.set('qux', 'foo'), 'used')
        await assert.throws(() => data.delete('foo'), 'used')
    })

    it('is iterable', () => {
        let data = new FormData()
        data.append('foo', 'bar')
        data.append('foo', 'baz')
        data.append('bar', 'qux')
        assert.deepEqual(Array.from(data.keys()), ['foo', 'bar'])
        assert.deepEqual(Array.from(data.entries()), [
            ['foo', 'bar'],
            ['foo', 'baz'],
            ['bar', 'qux']
        ])
        data.delete('foo')
        assert.deepEqual(Array.from(data.values()), ['qux']) // dumbest api ever
    })
})
