import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 내역서 파싱 - 수량>0인 실제 품목만 추출
function parseNaeyeokseo(sheets) {
  const sheet = sheets.find(s => s.name.includes('내역서')) || sheets[0];
  if (!sheet) return [];

  const rows = sheet.rows;
  const items = [];

  // 행2(index 1): 헤더 확인
  // 행3(index 2): 단가/금액 서브헤더
  // 행4(index 3)~: 실제 데이터
  // A=0:공종명, B=1:규격, C=2:수량, D=3:단위

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;

    const gongJongMyeong = String(row[0] || '').trim();
    const gyugyeok = String(row[1] || '').trim();
    const suryangRaw = row[2];
    const danwi = String(row[3] || '').trim();

    if (!gongJongMyeong) continue;

    // 수량 파싱
    const suryang = parseFloat(String(suryangRaw || '').replace(/,/g, ''));
    if (!suryang || suryang <= 0 || isNaN(suryang)) continue;

    // 단위 없으면 스킵
    if (!danwi) continue;

    items.push({
      gongJongMyeong,
      gyugyeok,
      suryang,
      danwi,
      row: i + 1,
    });
  }

  return items;
}

// 수량산출서 집계 시트 파싱
function parseSuryangsanchulFiles(allFiles) {
  const results = [];

  for (const file of allFiles) {
    // "집계" 포함 시트 찾기
    const jipgyeSheets = file.sheets.filter(s =>
        s.name.includes('집계') || s.name.includes('집 계')
      );

    for (const sheet of jipgyeSheets) {
      const rows = sheet.rows;
      if (!rows || rows.length === 0) continue;

      // 시트 전체 데이터를 텍스트로 변환 (AI 분석용)
      // 최대 50행만 (집계표는 보통 짧음)
      const textRows = rows.slice(0, 30).map((row, idx) =>
        `행${idx + 1}: ${row.slice(0, 15).join(' | ')}`
      ).join('\n');

      results.push({
        filename: file.filename,
        sheetName: sheet.name,
        textRows,
        rawRows: rows.slice(0, 60),
      });
    }
  }

  return results;
}

export async function POST(request) {
  try {
    // 1. 인증
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { projectId } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: 'projectId가 필요합니다.' }, { status: 400 });
    }

    // 2. 파일 목록 조회
    const { data: documents } = await supabase
      .from('documents')
      .select('*')
      .eq('project_id', projectId)
      .in('category', ['naeyeokseo', 'suryangsanchul']);

    if (!documents || documents.length === 0) {
      return NextResponse.json({ error: '내역서 또는 수량산출서 파일이 없습니다.' }, { status: 400 });
    }

    const naeyeokseoDoc = documents.find(d => d.category === 'naeyeokseo');
    const suryangsanchulDocs = documents.filter(d => d.category === 'suryangsanchul');

    if (!naeyeokseoDoc) {
      return NextResponse.json({ error: '내역서 파일이 없습니다.' }, { status: 400 });
    }
    if (suryangsanchulDocs.length === 0) {
      return NextResponse.json({ error: '수량산출서 파일이 없습니다.' }, { status: 400 });
    }

    // 3. 내역서 파싱
    const { data: naeyeokseoData, error: dlErr1 } = await supabase.storage
      .from('project-files').download(naeyeokseoDoc.storage_path);
    if (dlErr1) throw new Error(`내역서 다운로드 실패: ${dlErr1.message}`);

    const naeyeokseoAB = await naeyeokseoData.arrayBuffer();
    const naeyeokseoWB = XLSX.read(naeyeokseoAB, { type: 'array' });
    const naeyeokseoSheets = naeyeokseoWB.SheetNames.map(name => ({
      name,
      rows: XLSX.utils.sheet_to_json(naeyeokseoWB.Sheets[name], {
        header: 1, defval: '', blankrows: false, raw: false,
      }),
    }));

    const naeyeokseoItems = parseNaeyeokseo(naeyeokseoSheets);

    if (naeyeokseoItems.length === 0) {
      return NextResponse.json({ error: '내역서에서 품목을 추출하지 못했습니다.' }, { status: 400 });
    }

    // 4. 수량산출서 파싱
    const suryangsanchulFiles = [];
    for (const doc of suryangsanchulDocs) {
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('project-files').download(doc.storage_path);
      if (dlErr) continue;

      const ab = await fileData.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const sheets = wb.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name], {
          header: 1, defval: '', blankrows: false, raw: false,
        }),
      }));

      suryangsanchulFiles.push({ filename: doc.filename, sheets });
    }

    const jipgyeData = parseSuryangsanchulFiles(suryangsanchulFiles);

    if (jipgyeData.length === 0) {
      return NextResponse.json({ error: '수량산출서에서 집계 시트를 찾지 못했습니다.' }, { status: 400 });
    }

    // 5. Claude AI 매칭 분석
    // 내역서 품목을 50개씩 나눠서 처리 (토큰 한도 관리)
    const BATCH_SIZE = 50;
    const allResults = [];

    const naeyeokseoText = naeyeokseoItems
  .filter(item => item.danwi !== '식')  // "식" 단위 제거
  .slice(0, 50)  // 50개로 더 줄이기
  .map((item, idx) => `${idx + 1}. "${item.gongJongMyeong}" ${item.gyugyeok} ${item.suryang}${item.danwi}`)
  .join('\n');

    const jipgyeText = jipgyeData
      .map(j => `[파일: ${j.filename} / 시트: ${j.sheetName}]\n${j.textRows}`)
      .join('\n\n---\n\n');

    const prompt = `당신은 토목 내역서와 수량산출서를 비교 검토하는 전문가입니다.

## 내역서 품목 목록 (수량>0인 실제 품목들)
${naeyeokseoText}

## 수량산출서 집계 시트 데이터
${jipgyeText}

### 작업 지시
1. 내역서의 각 품목을 수량산출서 집계 시트에서 매칭하세요.
2. 매칭 규칙 (중요!):
   - 공종명에서 핵심 재료명이 겹치면 매칭 가능
     예: "PE관 접합 및 부설" ↔ "PE 이중벽관" → PE+관 겹침 → 매칭 ✅
     예: "흄관 설치" ↔ "흄관" → 흄관 겹침 → 매칭 ✅
     예: "폐기물 철거" ↔ "폐기물집계" → 폐기물 겹침 → 매칭 ✅
   - 규격에서 치수(D450, D300, T50 등)가 일치하면 같은 품목
     예: "D450mm, 전기융착식" ↔ "D450" → D450 일치 → 매칭 ✅
   - 공종명 핵심어 + 규격 치수 둘 다 겹치면 매칭 확정
   - 공종명만 겹치고 규격이 다르면 → 불일치
   - 완전히 다른 품목이면 → 매칭실패
3. 단위가 다른 경우는 매칭하지 마세요.
4. 집계 시트에서 "계" 또는 "합계" 행의 수량을 사용하세요.
5. 수량 차이가 0.1 이내면 "일치", 초과면 "불일치", 못찾으면 "매칭실패".

## 응답 형식 (JSON만, 마크다운 없이)
{
  "results": [
    {
      "naeyeokseo_item": "공종명",
      "gyugyeok": "규격",
      "danwi": "단위",
      "naeyeokseo_suryang": 숫자,
      "matched": true/false,
      "matched_file": "파일명 또는 null",
      "matched_sheet": "시트명 또는 null",
      "sanchul_suryang": 숫자 또는 null,
      "difference": 숫자 또는 null,
      "status": "일치" 또는 "불일치" 또는 "매칭실패",
      "note": "참고사항 (선택)"
    }
  ],
  "summary": {
    "total": 전체품목수,
    "matched_ok": 일치수,
    "matched_diff": 불일치수,
    "unmatched": 매칭실패수
  }
}`;

    const startTime = Date.now();
    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    });

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    const responseText = aiResponse.content.map(c => c.text || '').join('');

    // JSON 파싱
    const cleanText = responseText.replace(/```json|```/g, '').trim();
    console.log('AI 응답 앞부분:', cleanText.slice(0, 300));
    let parsed;
    try {
      parsed = JSON.parse(cleanText);
    } catch (e) {
      return NextResponse.json({
        error: 'AI 응답 파싱 실패',
        raw: responseText.slice(0, 500),
      }, { status: 500 });
    }

    // 6. 🔥 검증 결과 DB 저장 (Phase 5-3)
    const summary = parsed.summary || {};
    const results = parsed.results || [];

    let validationId = null;
    try {
      const { data: validation, error: insertError } = await supabase
        .from('validations')
        .insert({
          project_id: projectId,
          user_id: user.id,
          total_items: summary.total || results.length || 0,
          matched_ok: summary.matched_ok || 0,
          matched_diff: summary.matched_diff || 0,
          unmatched: summary.unmatched || 0,
          results: results,
          elapsed_seconds: parseFloat(elapsedSeconds),
          input_tokens: aiResponse.usage?.input_tokens || null,
          output_tokens: aiResponse.usage?.output_tokens || null,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[검증결과 DB 저장 실패]', insertError);
        // 저장 실패해도 클라이언트엔 결과는 반환 (UX 우선)
      } else {
        validationId = validation?.id || null;
        console.log('[검증결과 DB 저장 성공]', validationId);
      }
    } catch (dbError) {
      console.error('[검증결과 DB 저장 예외]', dbError);
      // 저장 실패해도 결과는 반환
    }

    return NextResponse.json({
      success: true,
      validationId,
      result: parsed,
      usage: {
        elapsedSeconds,
        inputTokens: aiResponse.usage?.input_tokens,
        outputTokens: aiResponse.usage?.output_tokens,
      },
    });

  } catch (error) {
    console.error('[검증 오류]', error);
    return NextResponse.json({ error: error.message || '검증 실패' }, { status: 500 });
  }
}
