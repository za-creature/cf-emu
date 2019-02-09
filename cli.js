let {version} = require('./package.json')
let yargs = require('yargs')

module.exports = yargs
    .wrap(yargs.terminalWidth()-1)
    .strict()
    .usage('Usage: cf-emu [-options]\n\n' +

           'This emulator implements a subset of the CF workers API,' +
           ' specifically the endpoint used for uploading workers. It will' +
           ' bind to a local port, listen for (optionally authenticated) API' +
           ' calls and deploy a new local server that runs the most recently' +
           ' uploaded worker.\n\n' +

           'If either the CF_TOKEN or CF_EMAIL and CF_APIKEY environment' +
           ' variables are exposed when running cf-emu, API authentication' +
           ' will be enabled, requiring an exact match to replace the' +
           ' currently running worker. If all three are provided, both token' +
           ' based auth as well as API-key auth are supported. Note: the' +
           ' provided values do not have to be valid as they are only used' +
           ' locally\n\n' +

           'If the -i option is used, the emulator switches to standalone' +
           ' mode where it will disable the API server completely then read ' +
           ' and deploy the worker from the provided file (use - for stdin)' +
           ' In this case, the file must either contain the javascript worker' +
           ' or the body of a valid multipart http request separated by a' +
           ' boundary (either default or explicitly set via -b). When using' +
           ' multipart, a part named "metadata" must contain a valid JSON' +
           ' naming the worker body part as well as any optional bindings\n\n' +

           'Once successfully started in API mode, it will run until it' +
           ' receives SIGINT (^C). When running in standalone mode, it will' +
           ' run until the worker crashes or it receives SIGINT. If the -w' +
           ' flag is present when running standalone, the worker will be' +
           ' automatically restarted as long as it doesn\'t crash on startup' +
           ' thus effectively running until ^C.\n\n' +

           'Returns 0 on graceful (^C) shutdown, 1 on configuration error, 2' +
           ' on worker configuration error or 3 on worker crash (without -w)' +
           ' or forceful (^C^C) termination\n')
    /* options */
    .option('a', {
        alias: 'api',
        nargs: 1,
        desc: 'port the api server listens on'
    })
    .option('b', {
        alias: 'boundary',
        nargs: 1,
        desc: 'the boundary used by the multipart request body'
    })
    .option('i', {
        alias: 'input',
        type: 'string',
        nargs: 1,
        desc: 'switch to standalone mode and read worker body from this file' +
              ' or stdin if -'
    })
    .option('f', {
        alias: 'forward',
        type: 'boolean',
        desc: 'if set, forward all failed requests to origin, regardless of' +
              ' whether passThroughOnException() is called by a handler or not',
    })
    .option('l', {
        alias: 'location',
        type: 'string',
        nargs: 1,
        desc: 'the value sent to the worker as the CF-IPCountry header',
        default: 'A1'
    })
    .option('o', {
        alias: 'origin',
        nargs: 1,
        desc: 'forward requests to this origin http(s) server if no fetch' +
              ' event handler issues a respondWith() or when an error was' +
              ' returned after calling passThroughOnException()'
    })
    .option('p', {
        alias: 'port',
        nargs: 1,
        desc: 'port the worker server listens on',
        default: 8080
    })
    .option('r', {
        alias: 'require',
        type: 'string',
        desc: 'include custom runtime(s) in the worker environment (e.g. to' +
              ' implement missing functionality or provide your own polyfills)'
    })
    .option('u', {
        alias: 'unsafe',
        type: 'boolean',
        desc: 'disable authentication, even when CF_* environment variables' +
              ' are present'
    })
    .option('w', {
        alias: 'watchdog',
        type: 'boolean',
        desc: 'automatically restart the worker when it crashes (at most' +
              ' once every 5 seconds)'
    })
    /* guidelines */
    .implies('forward', 'origin')
    .conflicts('input', ['api', 'unsafe'])
    .conflicts('boundary', ['api', 'unsafe'])
    /* other options */
    .config('c', 'read command line options from this JSON file instead')
    .help('h', 'show this message and exit')
    .version('v', 'show version number and exit', version)
    .alias({c: 'config', h: 'help', v: 'version'})
    /* groups */
    .group(['f', 'o', 'p', 'r', 'w'], 'Common options:')
    .group(['a', 'u'], 'Options for server mode:')
    .group(['b', 'i'], 'Options for standalone mode:')
    .group(['c', 'h', 'v'], 'Other options:')
    /* examples */
    .example('cf-emu -i my_worker.js', 'serve the worker from my_worker.js' +
                                       ' on the default port 8080')
    .example('cf-emu -b test_boundary -i -', 'serve the worker from the' +
                                          ' multipart body from stdin which' +
                                          ' is separated by --test_boundary')
    .example('sudo cf-emu -up80', 'serve the worker API endpoint on port 3333' +
                                  ' without authentication and deploy workers' +
                                  ' on port 80 (extremely unsafe!)')
    /* error handling */
    .fail((msg, err) => {
        /*istanbul ignore if*/
        if(err) throw err
        console.log(`cf-emu v${version}`)
        console.log()
        console.log('\x1b[91m%s\x1b[0m', msg)
        console.log('try "cf-emu --help" for options and examples')
        console.log()
        process.exit(1)
    })
