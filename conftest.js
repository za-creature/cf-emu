// add promise support to assert.throws
let {assert} = require('chai')
let _old = assert.throws
assert.throws = (fn, ...rest) => _try(fn).then(() => {}, _ => _).then(err => {
    _old.call(assert, () => {if(err) throw err}, ...rest)
})
let _try = Promise.prototype.then.bind(Promise.resolve())


// test helpers and defaults
exports.sleep = timeout => new Promise(res => setTimeout(res, timeout))
for(let [key, val] of Object.entries({
    MAJOR_NODE_VERSION: parseInt(process.versions.node.split('.')[0]),
    NODE_ENV: 'test',
    API_PORT: 12673,
    TEST_PORT: 12674,
    TEST_KEEPALIVE: 100,
}))
    exports[key] = process.env[key] || val
for(let key in exports)
    global[key] = exports[key]
