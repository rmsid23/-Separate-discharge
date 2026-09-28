/**
 * Vercel Serverless Function Handler
 * Route: /api/generate
 * Method: POST
 */
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { imageBase64, mimeType } = req.body || {};

  if (!imageBase64) {
    return res.status(400).json({ error: '이미지 데이터(imageBase64)가 필요합니다.' });
  }

  // Security: Read API key from environment variable
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: '서버 환경 변수에 GEMINI_API_KEY가 설정되지 않았습니다. Vercel 환경 변수를 확인해주세요.'
    });
  }

  const systemPrompt = `당신은 대한민국 환경부의 올바른 분리배출 가이드라인을 완벽히 숙지한 스마트 환경 AI 전문가입니다.
사용자가 제출한 쓰레기 사진을 정밀 분석하여 품목명, 분류, 배출 4단계 수칙, 재질별 분리법, 주의사항, 친환경 상식을 정확히 작성하세요.`;

  const userPrompt = `사진 속 쓰레기의 종류를 판별하고 올바른 분리배출 방법을 아래 지정된 JSON 규격으로 응답하세요:
{
  "itemName": "물품 이름 (예: 투명 페트병, 양념 컵라면 용기 등)",
  "category": "분류 카테고리 (플라스틱류, 종이팩, 비닐류, 일반쓰레기, 폐건전지, 스티로폼 등)",
  "recyclableType": "RECYCLABLE (재활용가능), CONDITIONAL (조건부배출), GENERAL (일반쓰레기), SPECIAL (특수배출)",
  "summary": "한 줄 배출 핵심 요약",
  "steps": [
    "1단계 내용 (비운다)",
    "2단계 내용 (헹군다)",
    "3단계 내용 (분리한다)",
    "4단계 내용 (섞지않는다)"
  ],
  "materialBreakdown": [
    { "part": "부위/구성", "material": "예상 재질", "method": "배출 장소 및 방법" }
  ],
  "caution": "주의사항 및 오염 시 일반쓰레기 전환 기준",
  "ecoTip": "친환경 상식 및 재활용 효과"
}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: userPrompt },
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: imageBase64
            }
          }
        ]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

  try {
    let response;
    let retries = 3;
    let backoff = 1000;

    while (retries > 0) {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) break;

      if (response.status === 429 && retries > 1) {
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff *= 2;
        retries--;
      } else {
        const errorText = await response.text();
        throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
      }
    }

    const resultData = await response.json();
    const resultText = resultData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!resultText) {
      return res.status(500).json({ error: 'Gemini API로부터 올바른 답변을 받지 못했습니다.' });
    }

    const parsedJson = JSON.parse(resultText);
    return res.status(200).json(parsedJson);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      error: '분석 중 오류가 발생했습니다.',
      details: error.message
    });
  }
}