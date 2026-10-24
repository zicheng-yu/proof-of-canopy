// Static assets don't answer Range requests, and Safari won't play an MP4 without them. Only
// /video/*.mp4 reaches this Worker (wrangler.jsonc run_worker_first); it streams the requested byte
// range out of the asset without buffering the whole file.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const asset = await env.ASSETS.fetch(new Request(request.url, { method: 'GET' }));
    const range = request.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
    const headers = new Headers(asset.headers);
    headers.set('accept-ranges', 'bytes');
    if (!asset.ok || !range || !asset.body) {
      return new Response(request.method === 'HEAD' ? null : asset.body, { status: asset.status, headers });
    }
    // The asset response may be chunked without a length; then read it once (the video is ~12 MB).
    const declared = Number(asset.headers.get('content-length'));
    if (!(declared > 0)) {
      const bytes = new Uint8Array(await asset.arrayBuffer());
      const [start, end] = bounds(range, bytes.length);
      if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${bytes.length}` } });
      headers.set('content-range', `bytes ${start}-${end}/${bytes.length}`);
      headers.set('content-length', String(end - start + 1));
      return new Response(request.method === 'HEAD' ? null : bytes.slice(start, end + 1), { status: 206, headers });
    }
    const size = declared;

    const [start, end] = bounds(range, size);
    if (start > end) {
      await asset.body.cancel();
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }

    let offset = 0;
    const slice = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const from = Math.max(start - offset, 0);
        const to = Math.min(end + 1 - offset, chunk.length);
        if (from < to) controller.enqueue(chunk.subarray(from, to));
        offset += chunk.length;
        if (offset > end) controller.terminate();
      },
    });
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(request.method === 'HEAD' ? null : asset.body.pipeThrough(slice), { status: 206, headers });
  },
};

/** Inclusive byte bounds for "bytes=a-b", "bytes=a-" and "bytes=-n". */
function bounds(range: RegExpMatchArray, size: number): [number, number] {
  const start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
  const end = range[1] === '' || range[2] === '' ? size - 1 : Number(range[2]);
  return [Math.max(0, start), Math.min(size - 1, end)];
}
