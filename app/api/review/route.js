import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * POST /api/review
 * Body: { projectId, projectName, excelData }
 * AI 검토 + DB 저장
 */
export async function POST(request) {
  try {
    // 1. 인증
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    // 2. 요청 데이터
    const body = await request.json();
    const { projectId, projectName, excelData } = body;

    if (!projectId || !excelData || excelData.length === 0) {
      return NextResponse.json({ error: '필수 데이터 누락' }, { status: 400 });
    }

    // 3. 프로젝트 소유권 확인
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: '프로젝트 접근 불가' }, { status: 403 });
    }

    // 4. 프롬프트 생성
    const prompt = buildReviewPrompt(projectName || project.name, excelData);

    // 5. Claude API 호출
    console.log('[AI 검토] Claude API 호출 시작...');
    const startTime = Date.now();

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[AI 검토] 완료! 소요시간: ${elapsed}초`);

    // 6. 응답 파싱
    const responseText = message.content[0].text;
    let parsedResult;
    try {
      const cleanText = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      parsedResult = JSON.parse(cleanText);
    } catch (parseError) {
      console.error('[AI 검토] JSON 파싱 실패:', parseError);
      return NextResponse.json({
        error: 'AI 응답 파싱 실패',
        rawResponse: responseText.substring(0, 1000),
      }, { status: 500 });
    }

    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      elapsedSeconds: parseFloat(elapsed),
    };

    // 7. 🔥 DB에 저장 (NEW!)
    console.log('[AI 검토] DB 저장 시작...');

    const { data: savedReview, error: reviewError } = await supabase
      .from('reviews')
      .insert({
        project_id: projectId,
        user_id: user.id,
        summary: parsedResult.summary || '',
        total_issues: parsedResult.totalIssues || 0,
        severity_critical: parsedResult.severity?.critical || 0,
        severity_warning: parsedResult.severity?.warning || 0,
        severity_info: parsedResult.severity?.info || 0,
        recommendations: parsedResult.recommendations || [],
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        elapsed_seconds: usage.elapsedSeconds,
        model_name: 'claude-sonnet-4-5-20250929',
      })
      .select()
      .single();

    if (reviewError) {
      console.error('[AI 검토] reviews 저장 실패:', reviewError);
      // DB 저장 실패해도 결과는 반환 (UX 우선)
    } else {
      console.log('[AI 검토] reviews 저장 성공:', savedReview.id);

      // 이슈 저장
      const issues = parsedResult.issues || [];
      if (issues.length > 0) {
        const issuesToInsert = issues.map((issue, idx) => ({
          review_id: savedReview.id,
          issue_order: idx + 1,
          severity: issue.severity || 'info',
          category: issue.category || '기타',
          title: issue.title || '',
          description: issue.description || '',
          evidence: issue.evidence || '',
          recommendation: issue.recommendation || '',
        }));

        const { error: issuesError } = await supabase
          .from('review_issues')
          .insert(issuesToInsert);

        if (issuesError) {
          console.error('[AI 검토] review_issues 저장 실패:', issuesError);
        } else {
          console.log(`[AI 검토] review_issues ${issues.length}개 저장 성공`);
        }
      }

      // 프로젝트 status를 'completed'로 업데이트
      await supabase
        .from('projects')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', projectId);
    }

    // 8. 성공 응답
    return NextResponse.json({
      success: true,
      result: parsedResult,
      usage,
      reviewId: savedReview?.id,
    });

  } catch (error) {
    console.error('[AI 검토] 에러:', error);

    if (error.status) {
      return NextResponse.json({
        error: `Claude API 에러: ${error.message}`,
      }, { status: error.status });
    }

    return NextResponse.json({
      error: error.message || '서버 오류'
    }, { status: 500 });
  }
}

/**
 * 토목 검토 프롬프트
 */
function buildReviewPrompt(projectName, excelData) {
  const dataSummary = excelData.map((file) => {
    const sheets = file.sheets.map((sheet) => {
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
      "description": "구체적인 설명",
      "evidence": "근거 데이터",
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
- 반드시 위 JSON 형식 그대로 답변
- 마크다운 코드블록(\`\`\`json...\`\`\`) 사용
- 이슈는 최대 10개
- 데이터에 명확히 근거한 이슈만 포함
- 한국어로 답변
- 데이터 부족하면 totalIssues: 0`;
}