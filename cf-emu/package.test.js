let {assert} = require('chai')
let {readFile} = require('fs')


describe('package', () => {
    it('syntax', next => {
        readFile('./package.json', (err, res) => {
            if(err)
                return next(err)
            try {
                JSON.parse(res)
                next()
            } catch(err) {
                next(err)
            }
        })
    })
    it('version', () => {
        let {version} = require('./package.json')
        assert.match(version, /^\d+\.\d+.\d+$/)
    })

    it('bugs', () => {
        let {bugs} = require('./package.json')
        assert.isString(bugs.url)
    })
})
