// defaults for test environment
for(let [key, val] of Object.entries({
    NODE_ENV: 'test',
    API_PORT: 12673,
    TEST_PORT: 12674
})) process.env[key] = process.env[key] || val


// most tests assume that the runtime is imported
require('./runtime')


// add promise support to assert.throws
let {assert} = require('chai')
let _old = assert.throws
assert.throws = (fn, ...rest) => _try(fn).then(() => {}, _ => _).then(err => {
    _old.call(assert, () => {if(err) throw err}, ...rest)
})
let _try = Promise.prototype.then.bind(Promise.resolve())
