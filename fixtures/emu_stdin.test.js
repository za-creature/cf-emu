let emu = require('..')

process.once('SIGINT', () => proc.close())
let proc = emu({
    input: '-',
    port: Number(process.env.TEST_PORT)
})
