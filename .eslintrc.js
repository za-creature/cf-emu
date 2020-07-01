module.exports = {
    extends: 'eslint:recommended',
    env: {
        es2020: true,
        node: true
    },
    rules: {
        indent: ['off'],
        'linebreak-style': ['error', 'unix'],
        quotes: ['error', 'single'],
        semi: ['error', 'never'],
        'no-cond-assign': ['off'],
        'no-trailing-spaces': ['error']
    },
    overrides: [{
        files: ['**/*.test.js'],
        env: {
            mocha: true
        },
        globals: Object.fromEntries(Object.keys(require('./conftest')).map(key => [key, false]))
    }]
}
