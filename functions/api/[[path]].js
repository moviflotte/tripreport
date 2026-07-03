export const onRequest = ({request, env}, cf) => {
    const url = new URL(request.url)
    url.host = env.TRACCAR_SERVER || 'moviflotte.com'
    const upstreamRequest = new Request(new Request(url, request), { redirect: 'follow' })
    return fetch(upstreamRequest, cf)
}
