export const onRequest = ({request, env}, cf) => {
    const url = new URL(request.url)
    url.host = env.TRACCAR_SERVER || 'api.pinme.io'
    url.port = 80
    url.protocol = 'https:'
    console.log(url)
    const upstreamRequest = new Request(new Request(url, request), { redirect: 'follow' })
    return fetch(upstreamRequest, cf)
}
