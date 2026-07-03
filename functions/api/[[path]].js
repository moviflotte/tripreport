export const onRequest = ({request, env}, cf) => {
    const url = new URL(request.url)
    url.host = env.TRACCAR_SERVER || 'moviflotte.com'
    return fetch(new Request(url, request, { redirect: 'follow' }), cf)
}
