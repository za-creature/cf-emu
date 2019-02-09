let {Stackless, buffer, random_hex, stream} = require('./util')

let {assert} = require('chai')


describe('util', () => {
    it('Stackless', () => {
        assert.equal(new Stackless().toString().indexOf('\n'), -1)
    })

    it('random_hex', () => {
        let hex = random_hex(32)
        assert.match(hex, /^[0-9a-f]{32}$/)
    })

    it('`buffer` is a writable stream', async () => {
        let req = buffer()
        req.write('hello', 'utf-8')
        req.end()
        assert.deepEqual(await req.promise, new TextEncoder().encode('hello'))
    })

    it('`stream` is a readable stream', async () => {
        let input = crypto.getRandomValues(new Uint8Array(1024))
        let output = await buffer.consume(stream(input))
        assert.deepEqual(input, output)
    })
})
