import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Anthropic 클라이언트 초기화
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * POST /api/review
 * Body: { projectId, excelData }
 *
 * 토목 내역서 검토 요청을 받아 Claude API로 분석 후 결과 반환
 */
export async function POST(request) {
  try {
    // 1. 인증 확인
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: '로그인이 필요합니다.' },
        { status: 401 }
      );
    }

    // 2. 요청 데이터 파싱
    const body = await request.json();
    const { projectId, projectName, excelData } = body;

    if (!projectId || !excelData || excelData.length === 0) {
      return NextResponse.json(
        { error: '필수 데이터가 누락되었습니다.' },
        { status: 400 }
      );
    }

    // 3. 프로젝트 소유권 확인
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: '프로젝트에 접근할 수 없습니다.' },
        { status: 403 }
      );
    }

    // 4. Claude에게 보낼 프롬프트 생성
    const prompt = buildReviewPrompt(projectName || project.name, excelData);

    // 5. Claude API 호출
    console.log('[AI 검토] Claude API 호출 시작...');
    const startTime = Date.now();

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[AI 검토] 완료! 소요시간: ${elapsed}초`);

    // 6. 응답 파싱
    const responseText = message.content[0].text;

    // JSON 부분 추출 (```json ... ``` 형식 또는 그냥 JSON)
    let parsedResult;
    try {
      // 마크다운 코드블록 제거
      const cleanText = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      parsedResult = JSON.parse(cleanText);
    } catch (parseError) {
      console.error('[AI 검토] JSON 파싱 실패:', parseError);
      console.error('원본 응답:', responseText);
      return NextResponse.json(
        {
          error: 'AI 응답을 파싱할 수 없습니다.',
          rawResponse: responseText.substring(0, 1000),
        },
        { status: 500 }
      );
    }

    // 7. 사용량 정보
    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      elapsedSeconds: parseFloat(elapsed),
    };

    // 8. 성공 응답
    return NextResponse.json({
      success: true,
      result: parsedResult,
      usage,
    });

  } catch (error) {
    console.error('[AI 검토] 에러:', error);

    // Anthropic API 에러
    if (error.status) {
      return NextResponse.json(
        {
          error: `Claude API 에러: ${error.message}`,
          details: error.error,
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: error.message || '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

/**
 * 토목 검토 프롬프트 생성
 */
function buildReviewPrompt(projectName, excelData) {
  // 각 카테고리별 데이터 요약 (토큰 절약)
  const dataSummary = excelData.map((file) => {
    const sheets = file.sheets.map((sheet) => {
      // 각 시트의 첫 50행만 (너무 많으면 토큰 초과)
      const sampleRows = sheet.rows.slice(0, 50);
      return `### 시트: ${sheet.name} (${sheet.rowCount}행 × ${sheet.colCount}열)
${sampleRows.map(row => row.join(' | ')).join('\n')}
${sheet.rowCount > 50 ? `... 외 ${sheet.rowCount - 50}행 더 있음` : ''}`;
    }).join('\n\n');

    return `## 📂 ${file.label} (${file.filename})
${file.summary}

${sheets}`;
  }).join('\n\n---\n\n');

  return `당신은 한국 토목 내역서 검토 전문가입니다. 30년 경력의 토목 적산 베테랑이며, 단가 검증, 일위대가 분석, 노무비/자재비 적정성 판단에 능통합니다.

# 검토 대상 프로젝트
**공사명**: ${projectName}

# 첨부된 내역서 데이터
${dataSummary}

# 검토 지시사항
다음 관점에서 종합적으로 검토하고, 발견된 이슈를 JSON 형식으로 답변하세요:

1. **단가 적정성**: 표준시장단가 대비 일위대가의 단가가 합리적인가?
2. **노무비 검증**: 일위대가의 노무비가 노임단가에 맞게 산출되었는가?
3. **자재비 검증**: 자재단가표와 일위대가의 자재비가 일치하는가?
4. **품셈 정합성**: 품셈 기준대로 인력 및 시간이 산정되었는가?
5. **이상치 탐지**: 비정상적으로 높거나 낮은 단가, 누락된 항목

# 답변 형식 (반드시 이 JSON 형식으로!)
\`\`\`json
{
  "summary": "전체 검토 요약 (2~3문장)",
  "totalIssues": 발견된_이슈_총_개수,
  "severity": {
    "critical": 심각_이슈_수,
    "warning": 경고_이슈_수,
    "info": 정보_이슈_수
  },
  "issues": [
    {
      "id": 1,
      "severity": "critical" | "warning" | "info",
      "category": "단가" | "노무비" | "자재비" | "품셈" | "기타",
      "title": "이슈 제목 (한 줄)",
      "description": "구체적인 설명 (어떤 항목이 어떤 점에서 문제인지)",
      "evidence": "근거 데이터 (어떤 셀, 어떤 값에서 발견했는지)",
      "recommendation": "권장 조치사항"
    }
  ],
  "recommendations": [
    "전체적인 권장사항 1",
    "전체적인 권장사항 2"
  ]
}
\`\`\`

# 중요 규칙
- 반드시 위 JSON 형식 그대로 답변 (다른 텍스트 X)
- 마크다운 코드블록(\`\`\`json...\`\`\`) 사용
- 이슈는 최대 10개 (가장 중요한 것부터)
- 데이터에 명확히 근거한 이슈만 포함 (추측 X)
- 한국어로 답변
- 데이터가 부족하면 totalIssues: 0, issues: [] 으로 답변하고 summary에 사유 명시`;
}