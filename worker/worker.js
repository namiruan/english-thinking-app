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

    // ── 대화·사전: Groq (OpenAI 호환) ──
    if (String(body.kind || '') === 'chat') {
      if (!env.GROQ_API_KEY) {
        return new Response('no groq key: set GROQ_API_KEY secret', { status: 500, headers: CORS });
      }
      const gres = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + env.GROQ_API_KEY,
        },
        body: JSON.stringify({
          model: String(body.model || 'openai/gpt-oss-120b'),
          messages: Array.isArray(body.messages) ? body.messages : [],
          temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
          // response_format(json_object)은 추론형 모델에서 400을 유발 → 프롬프트+클라 파싱으로 처리
        }),
      });
      const gbody = await gres.text();
      return new Response(gbody, {
        status: gres.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const text = String(body.text || '').slice(0, 1000).trim();
    const speaker = String(body.speaker || 'asteria');
    if (!text) return new Response('no text', { status: 400, headers: CORS });

    // ── Google Cloud TTS (매월 100만 자 무료) ──
    if (String(body.provider || '') === 'google') {
      if (!env.GOOGLE_TTS_KEY) {
        return new Response('no google key: set GOOGLE_TTS_KEY secret', { status: 500, headers: CORS });
      }
      const voice = String(body.voice || 'en-US-Neural2-F');
      const languageCode = voice.split('-').slice(0, 2).join('-') || 'en-US';
      const gres = await fetch(
        'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + env.GOOGLE_TTS_KEY,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode, name: voice },
            audioConfig: { audioEncoding: 'MP3' },
          }),
        },
      );
      if (!gres.ok) {
        const detail = await gres.text().catch(() => '');
        return new Response(('google tts ' + gres.status + ': ' + detail).slice(0, 300), {
          status: gres.status,
          headers: CORS,
        });
      }
      const j = await gres.json();
      const b64 = j && j.audioContent;
      if (!b64) return new Response('google tts: empty audio', { status: 502, headers: CORS });
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      });
    }

    // 모델 선택 (화이트리스트)
    const MODELS = { 'aura-1': '@cf/deepgram/aura-1', 'aura-2-en': '@cf/deepgram/aura-2-en' };
    const modelId = MODELS[String(body.model || 'aura-1')] || MODELS['aura-1'];
    // 두 모델 모두 speaker 지원

    try {
      const resp = await env.AI.run(modelId, { text, speaker }, { returnRawResponse: true });
      // returnRawResponse는 한도 초과/오류 시에도 throw 없이 에러 응답을 그대로 줄 수 있음.
      // 오디오가 아니면 진짜 상태코드/내용을 클라이언트로 전달한다 (예: 429 한도).
      const ct = resp.headers.get('content-type') || '';
      if (!resp.ok || !/audio|mpeg|mp3|octet-stream/i.test(ct)) {
        const detail = await resp.text().catch(() => '');
        const status = resp.status && resp.status >= 400 ? resp.status : 502;
        return new Response(('tts upstream ' + resp.status + ': ' + (detail || ct)).slice(0, 300), {
          status,
          headers: CORS,
        });
      }
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
