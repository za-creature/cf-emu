addEventListener('fetch', ev => {
    ev.respondWith(new Response('hello world'))
})
