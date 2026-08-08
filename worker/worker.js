/**
 * 영어식 사고 — 클라우드 TTS 프록시 (Cloudflare Workers AI · Deepgram Aura)
 *
 * 브라우저에서 문장을 보내면 서버(엣지)에서 자연스러운 음성을 만들어 mp3로 돌려줍니다.
 * 아이폰/아이패드/맥 어디서든 "오디오 재생"만 하면 되므로 빠르고 자연스러워요.
 *
 * 배포: 아래 README.md 참고 (wrangler deploy 또는 대시보드).
 * 남용 방지: (선택) 시크릿을 설정하면 X-Secret 헤더가 일치할 때만 동작.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Secret',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') {
      return new Response('POST only', { status: 405, headers: CORS });
    }

    // (선택) 시크릿 검사 — TTS_SECRET을 설정했다면 헤더가 일치해야 함
    if (env.TTS_SECRET && request.headers.get('X-Secret') !== env.TTS_SECRET) {
      return new Response('unauthorized', { status: 401, headers: CORS });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('bad json', { status: 400, headers: CORS });
    }

    const text = String(body.text || '').slice(0, 1000).trim();
    const speaker = String(body.speaker || 'asteria');
    if (!text) return new Response('no text', { status: 400, headers: CORS });

    // 모델 선택 (화이트리스트)
    const MODELS = { 'aura-1': '@cf/deepgram/aura-1', 'aura-2-en': '@cf/deepgram/aura-2-en' };
    const modelId = MODELS[String(body.model || 'aura-1')] || MODELS['aura-1'];
    // 두 모델 모두 speaker 지원

    try {
      const resp = await env.AI.run(modelId, { text, speaker }, { returnRawResponse: true });
      return new Response(resp.body, {
        headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      return new Response('tts error: ' + (e && e.message ? e.message : String(e)), {
        status: 500,
        headers: CORS,
      });
    }
  },
};
