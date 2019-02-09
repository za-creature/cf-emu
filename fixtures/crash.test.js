addEventListener('fetch', ev => {
    ev.respondWith(new Response('hello world'))
    if(self['crash'])
        process.exit()
})
