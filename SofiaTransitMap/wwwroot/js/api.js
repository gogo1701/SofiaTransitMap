// Thin JSON client for the SofiaTransitMap API.
export class ApiError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export async function api(path, { signal, params } = {}) {
    const url = new URL(`/api/${path}`, location.origin);
    if (params) {
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
        });
    }
    let res;
    try {
        res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new ApiError('Network error', 0, 'network');
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(body?.message || res.statusText, res.status, body?.code);
    return body;
}

/** Retries while the server is still loading the GTFS schedule (HTTP 503). */
export async function apiReady(path, opts = {}, tries = 12) {
    for (let i = 0; ; i++) {
        try {
            return await api(path, opts);
        } catch (err) {
            if (err.code !== 'feed-loading' || i >= tries || opts.signal?.aborted) throw err;
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}
