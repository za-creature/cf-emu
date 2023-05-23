/* global WebAssembly:false */
let {FormData} = require('../runtime')
let {parse, piccolo, Blob, File} = require('./multipart')
let {stream} = require('./util')

let {assert} = require('chai')


describe('multipart', () => {
    describe('File', () => {
        let file
        it('is a constructor', () => {
            assert.isFunction(File)
            file = new File([Buffer.from('{}')], 'foo', {
                type: 'application/json',
                lastModified: 1234
            })
        })

        it('implements the File interface', () => {
            assert.instanceOf(file, File)
            assert.equal(file.lastModified, 1234)
            if(MAJOR_NODE_VERSION < 20) {
                // removed from standard
                assert.instanceOf(file.lastModifiedDate, Date)
                assert.equal(file.lastModifiedDate.getTime(), 1234)
            }
            assert.equal(file.name, 'foo')
        })

        it('inherits from Blob', async () => {
            assert.instanceOf(file, Blob)
            assert.equal(file.size, 2)
            assert.equal(file.type, 'application/json')
            assert.equal(await file.text(), '{}')
        })
    })

    describe('piccolo', () => {
        it('supports urlencoded forms', async () => {
            let data = await piccolo(
                {'content-type': 'application/x-www-form-urlencoded'},
                stream(Buffer.from('foo=bar&baz=qux&foo=baz'))
            )
            assert.deepEqual(data.getAll('foo'), ['bar', 'baz'])
            assert.equal(data.get('baz'), 'qux')
        })

        it('supports multipart with fields and files', async () => {
            let data = await piccolo(
                {'content-type': 'multipart/form-data; boundary=sep'},
                stream(Buffer.from([
                    '--sep',
                    'Content-Disposition: form-data; name="key"',
                    '',
                    'val',
                    '--sep',
                    'Content-Disposition: form-data; name="file1"; filename="a.txt"',
                    'Content-Type: text/plain',
                    '',
                    'text',
                    '--sep',
                    'Content-Disposition: form-data; name="file2"; filename="a.html"',
                    'Content-Type: text/html',
                    '',
                    '<!DOCTYPE html>',
                    '--sep--`'
                ].join('\r\n')))
            )
            assert.equal(data.get('key'), 'val')
            let file = data.get('file1')
            //assert.instanceOf(file, File)
            assert.equal(file.name, 'a.txt')
            assert.equal(file.type, 'text/plain')
            assert.equal(await file.text(), 'text')

            file = data.get('file2')
            //assert.instanceOf(file, File)
            assert.equal(file.name, 'a.html')
            assert.equal(file.type, 'text/html')
            assert.equal(await file.text(), '<!DOCTYPE html>')
        })
    })


    describe('parse', () => {
        let main = 'addEventListener("fetch", e => e.respondWith("hello"))'
        it('throws when no metadata part exists', () => {
            let form = new FormData()
            return assert.throws(() => parse(form), 'metadata')
        })

        it('throws when metadata is not valid JSON', () => {
            let form = new FormData()
            form.append('metadata', new File([Buffer.from(main)],
                                             'metadata.json',
                                             {type: 'application/json'}))
            return assert.throws(() => parse(form), 'JSON')
        })

        it('throws when body_part is missing', () => {
            let form = new FormData()
            form.append('metadata', '{}')
            return assert.throws(() => parse(form), 'body_part')
        })

        it('throws when body_part references inexistent part', () => {
            let form = new FormData()
            form.append('metadata', JSON.stringify({body_part: 'dummy'}))
            return assert.throws(() => parse(form), 'dummy')
        })

        let valid_request = (bindings) => {
            let form = new FormData()
            form.append('main', new Blob([Buffer.from(main)]), 'main.js')
            form.append('metadata', JSON.stringify({body_part: 'main', bindings}))
            return form
        }

        it('throws when bindings is defined and not an array', () => {
            let form = valid_request(1234)
            return assert.throws(() => parse(form), 'number')
        })

        it('throws when binding is not an object', () => {
            let form = valid_request(['dummy'])
            return assert.throws(() => parse(form), 'dummy')
        })

        it('throws when binding is not named', () => {
            let form = valid_request([{text: 'dummy'}])
            return assert.throws(() => parse(form), 'name')
        })

        it('throws when binding name, text, part or namespace_id is not a string', async () => {
            await assert.throws(() => parse(valid_request([{name: 5}])), 'name')
            let name = 'test'
            await assert.throws(() => parse(valid_request([{name, text: 4}])), 'text')
            await assert.throws(() => parse(valid_request([{name, part: 3}])), 'part')
            await assert.throws(() => parse(valid_request([{name, namespace_id: 2}])), 'namespace_id')
        })

        it('throws when binding is of unknown type', () => {
            let form = valid_request([{name: 'test', type: 'dummy'}])
            return assert.throws(() => parse(form), 'dummy')
        })

        it('throws when text bindings don\'t provide \'text\'', async () => {
            let form = valid_request([{name: 'test', type: 'plain_text'}])
            await assert.throws(() => parse(form), 'without')
            form = valid_request([{name: 'test', type: 'secret_text'}])
            await assert.throws(() => parse(form), 'without')
        })

        it('throws when kv bindings don\'t provide \'namespace_id\'', async () => {
            let form = valid_request([{name: 'test', type: 'kv_namespace'}])
            await assert.throws(() => parse(form), 'without')
        })

        it('throws when wasm bindings don\'t provide \'part\'', async () => {
            let form = valid_request([{name: 'test', type: 'wasm_module'}])
            await assert.throws(() => parse(form), 'without')
        })

        it('throws when binding references inexistent part', async () => {
            let form = valid_request([{name: 'external', type: 'text_blob', part: 'dummy'}])
            await assert.throws(() => parse(form), 'dummy')
            form = valid_request([{name: 'external', type: 'wasm_module', part: 'dummy'}])
            return assert.throws(() => parse(form), 'dummy')
        })

        it('returns the module code', async () => {
            let code = await parse(valid_request())
            assert.equal(code, main)
        })

        it('exports text bindings', async () => {
            let form = valid_request([
                {name: 'username', type: 'plain_text', text: 'foo'},
                {name: 'password', type: 'secret_text', text: 'bar'}
            ])
            let result = {}
            await parse(form, result)
            assert.equal(result.username, 'foo')
            assert.equal(result.password, 'bar')
        })

        it('exports blob bindings', async () => {
            let form = valid_request([{name: 'test', type: 'text_blob', part: 'blob'}])
            form.append('blob', 'hello text')
            let result = {}
            await parse(form, result)
            assert.equal(result.test, 'hello text')

            form = valid_request([{name: 'test', type: 'text_blob', part: 'blob'}])
            form.append('blob', new File(['hello blob'], 'assets.bar'))
            result = {}
            await parse(form, result)
            assert.equal(result.test, 'hello blob')
        })

        it('compiles wasm bindings', async () => {
            let form = valid_request([{name: 'test', type: 'wasm_module', part: 'blob'}])
            form.append('blob', new File([
                Buffer.from('AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=', 'base64')
            ], 'add.wasm'))

            let result = {}
            await parse(form, result)
            assert.instanceOf(result.test, WebAssembly.Module)
            let instance = await new WebAssembly.Instance(result.test, {env: {
                memoryBase: 0,
                memory: new WebAssembly.Memory({initial: 256}),
                tableBase: 0,
                table: new WebAssembly.Table({initial: 0, element: 'anyfunc'})
            }})
            assert.equal(instance.exports.add(3, 4), 7)
        })

        it('ignores kv bindings', async () => {
            let form = valid_request([{name: 'test', type: 'kv_namespace', namespace_id: 'asd'}])

            let result = {}
            await parse(form, result)
            assert.notExists(result.test)
        })
    })
})
