import * as XLSX from 'xlsx';

/**
 * Excel 파일을 파싱해서 구조화된 데이터로 반환
 * @param {ArrayBuffer | Blob} fileData - Excel 파일 데이터
 * @returns {Promise<{ sheets: Array, summary: string, totalRows: number }>}
 */
export async function parseExcelFile(fileData) {
  try {
    // ArrayBuffer로 변환 (Blob이면)
    const arrayBuffer = fileData instanceof Blob
      ? await fileData.arrayBuffer()
      : fileData;

    // SheetJS로 파싱
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellDates: true, // 날짜를 Date 객체로
      cellNF: false,    // 숫자 포맷 무시 (속도)
      cellText: false,  // 텍스트 포맷 무시 (속도)
    });

    const sheets = [];
    let totalRows = 0;
    let totalCells = 0;

    // 모든 시트 순회
    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];

      // 시트를 2D 배열로 변환
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,        // 첫 행을 키로 쓰지 말고 인덱스로
        defval: '',       // 빈 셀은 빈 문자열
        blankrows: false, // 빈 행 제외
        raw: false,       // 모든 값을 문자열로
      });

      // 빈 시트는 제외
      if (rows.length === 0) return;

      // 셀 카운트
      const cellCount = rows.reduce((sum, row) => sum + row.length, 0);

      sheets.push({
        name: sheetName,
        rows: rows,
        rowCount: rows.length,
        colCount: Math.max(...rows.map(r => r.length), 0),
      });

      totalRows += rows.length;
      totalCells += cellCount;
    });

    // 요약 정보 생성
    const summary = `${sheets.length}개 시트, 총 ${totalRows.toLocaleString()}행, ${totalCells.toLocaleString()}셀`;

    return {
      sheets,
      summary,
      totalRows,
      totalCells,
      sheetCount: sheets.length,
    };

  } catch (error) {
    console.error('Excel 파싱 에러:', error);
    throw new Error(`Excel 파일을 읽을 수 없습니다: ${error.message}`);
  }
}

/**
 * 파싱된 시트 데이터를 AI가 읽기 좋은 텍스트로 변환
 * @param {Array} sheets - parseExcelFile()의 결과 sheets
 * @returns {string} 마크다운 형식의 텍스트
 */
export function sheetsToMarkdown(sheets) {
  let markdown = '';

  sheets.forEach((sheet, idx) => {
    markdown += `## 시트 ${idx + 1}: ${sheet.name}\n`;
    markdown += `(${sheet.rowCount}행 × ${sheet.colCount}열)\n\n`;

    if (sheet.rows.length === 0) {
      markdown += '(빈 시트)\n\n';
      return;
    }

    // 첫 행을 헤더로 가정
    const header = sheet.rows[0];
    const dataRows = sheet.rows.slice(1);

    // 마크다운 테이블 생성
    markdown += '| ' + header.map(h => String(h || '')).join(' | ') + ' |\n';
    markdown += '| ' + header.map(() => '---').join(' | ') + ' |\n';

    dataRows.forEach((row) => {
      // 헤더 길이에 맞춰 패딩
      const paddedRow = [...row];
      while (paddedRow.length < header.length) paddedRow.push('');

      markdown += '| ' + paddedRow.map(c => String(c || '').replace(/\|/g, '\\|')).join(' | ') + ' |\n';
    });

    markdown += '\n';
  });

  return markdown;
}

/**
 * Supabase Storage에서 파일 다운로드 후 파싱
 * @param {Object} supabase - Supabase 클라이언트
 * @param {string} storagePath - Storage 내 파일 경로
 * @returns {Promise<Object>} 파싱 결과
 */
export async function fetchAndParseExcel(supabase, storagePath) {
  // Storage에서 파일 다운로드
  const { data, error } = await supabase.storage
    .from('project-files')
    .download(storagePath);

  if (error) {
    throw new Error(`파일 다운로드 실패: ${error.message}`);
  }

  if (!data) {
    throw new Error('파일 데이터가 비어있습니다.');
  }

  // 파싱
  return await parseExcelFile(data);
}