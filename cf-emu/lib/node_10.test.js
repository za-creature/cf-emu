let {assert} = require('chai')
let {TextEncoder, TextDecoder, Promise_allSettled} = require('./node_10')


describe('node 10', () => {
    it('TextEncoder', () => {
        let encoder = new TextEncoder()
        assert.isFunction(encoder.encode)
        assert.equal(encoder.encoding, 'utf-8')
        assert.deepEqual(new TextEncoder().encode('ă'), Uint8Array.from([196, 131]))
    })


    it('TextDecoder', () => {
        let decoder = new TextDecoder()
        assert.isFunction(decoder.decode)
        assert.equal(decoder.encoding, 'utf-8')
        assert.equal(decoder.decode(Uint8Array.from([196, 131])), 'ă')
    })
    describe('TextDecoder', () => {
        it('throws on unsupported', () => assert.throws(
            () => new TextDecoder('foo')
        , 'foo'))
        it('throws in strict mode', () => assert.throws(() =>
            new TextDecoder('utf-8', {fatal: true})
        , 'fatal'))
    })


    it('Promise.allSettled', async () => {
        let baz = new TypeError()
        assert.deepEqual(await Promise_allSettled([
            Promise.resolve(),
            Promise.reject('foo'),
            Promise.resolve('bar'),
            Promise.reject(baz)
        ]), [
            {status: 'fulfilled', value: undefined},
            {status: 'rejected', reason: 'foo'},
            {status: 'fulfilled', value: 'bar'},
            {status: 'rejected', reason: baz}
        ])
    })
})