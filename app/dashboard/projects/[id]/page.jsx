'use client';

import * as XLSX from 'xlsx';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const FILE_CATEGORY_LABELS = {
  pumseum: '품셈',
  ilwidaega: '일위대가',
  noim: '노임단가',
  jajae: '자재단가',
  pyojun: '표준시장단가',
  naeyeokseo: '내역서',
  suryangsanchul: '수량산출서',
};

const FILE_CATEGORY_EMOJIS = {
  pumseum: '1️⃣',
  ilwidaega: '2️⃣',
  noim: '3️⃣',
  jajae: '4️⃣',
  pyojun: '5️⃣',
  naeyeokseo: '📋',
  suryangsanchul: '📊',
};

const STATUS_BADGES = {
  pending: { label: '대기', className: 'bg-gray-100 text-gray-700' },
  analyzing: { label: '분석 중', className: 'bg-blue-100 text-blue-700' },
  completed: { label: '완료', className: 'bg-green-100 text-green-700' },
  failed: { label: '실패', className: 'bg-red-100 text-red-700' },
};

const SEVERITY_STYLES = {
  critical: {
    label: '🔴 심각',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    titleColor: 'text-red-900',
    badgeColor: 'bg-red-100 text-red-700',
  },
  warning: {
    label: '🟡 경고',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    titleColor: 'text-yellow-900',
    badgeColor: 'bg-yellow-100 text-yellow-700',
  },
  info: {
    label: '🔵 정보',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    titleColor: 'text-blue-900',
    badgeColor: 'bg-blue-100 text-blue-700',
  },
};

const VALIDATION_CATEGORIES = ['naeyeokseo', 'suryangsanchul'];
const CROSS_CATEGORIES = ['pumseum', 'ilwidaega', 'noim', 'jajae', 'pyojun'];

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

async function parseExcelFile(fileData) {
  const arrayBuffer = fileData instanceof Blob ? await fileData.arrayBuffer() : fileData;
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheets = [];
  let totalRows = 0;
  let totalCells = 0;

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1, defval: '', blankrows: false, raw: false,
    });
    if (rows.length === 0) return;
    const cellCount = rows.reduce((sum, row) => sum + row.length, 0);
    sheets.push({
      name: sheetName, rows,
      rowCount: rows.length,
      colCount: Math.max(...rows.map(r => r.length), 0),
    });
    totalRows += rows.length;
    totalCells += cellCount;
  });

  const summary = `${sheets.length}개 시트, 총 ${totalRows.toLocaleString()}행, ${totalCells.toLocaleString()}셀`;
  return { sheets, summary, totalRows, totalCells, sheetCount: sheets.length };
}

async function fetchAndParseExcel(supabase, storagePath) {
  const { data, error } = await supabase.storage.from('project-files').download(storagePath);
  if (error) throw new Error(`파일 다운로드 실패: ${error.message}`);
  if (!data) throw new Error('파일 데이터가 비어있습니다.');
  return await parseExcelFile(data);
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const projectId = params.id;

  const [project, setProject] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState({ step: '', current: 0, total: 0 });
  const [extractResults, setExtractResults] = useState(null);
  const [extractError, setExtractError] = useState(null);

  const [reviewing, setReviewing] = useState(false);
  const [reviewProgress, setReviewProgress] = useState('');
  const [reviewResult, setReviewResult] = useState(null);
  const [reviewError, setReviewError] = useState(null);

  const [naeyeokseoFile, setNaeyeokseoFile] = useState(null);
  const [suryangsanchulFiles, setSuryangsanchulFiles] = useState([]);
  const [uploadingValidation, setUploadingValidation] = useState(false);
  const [validationUploadProgress, setValidationUploadProgress] = useState('');
  const [validationUploadDone, setValidationUploadDone] = useState(false);
  // 내역서 검증 결과 상태
  const [validating, setValidating] = useState(false);
  const [validationProgress, setValidationProgress] = useState('');
  const [validationResult, setValidationResult] = useState(null);
  const [validationError, setValidationError] = useState(null);

  useEffect(() => {
    async function fetchProjectData() {
      try {
        const { data: projectData, error: projectError } = await supabase
          .from('projects').select('*').eq('id', projectId).single();
        if (projectError) throw new Error(`프로젝트 조회 실패: ${projectError.message}`);
        if (!projectData) throw new Error('프로젝트를 찾을 수 없습니다.');
        setProject(projectData);

        const { data: docsData, error: docsError } = await supabase
          .from('documents').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
        if (docsError) throw new Error(`문서 조회 실패: ${docsError.message}`);
        setDocuments(docsData || []);
      } catch (err) {
        console.error('데이터 로딩 에러:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchProjectData();
  }, [projectId]);

  const handleExtractText = async () => {
    setExtracting(true);
    setExtractError(null);
    setExtractResults(null);
    try {
      const crossDocs = documents.filter(doc =>
        CROSS_CATEGORIES.includes(doc.category) &&
        ['.xlsx', '.xls'].some(ext => (doc.filename || '').toLowerCase().endsWith(ext))
      );
      if (crossDocs.length === 0) throw new Error('교차 검토용 Excel 파일이 없습니다.');
      const results = [];
      for (let i = 0; i < crossDocs.length; i++) {
        const doc = crossDocs[i];
        const label = FILE_CATEGORY_LABELS[doc.category] || doc.category;
        setExtractProgress({ step: `파싱 중: ${label}`, current: i + 1, total: crossDocs.length });
        try {
          const parseResult = await fetchAndParseExcel(supabase, doc.storage_path);
          results.push({ documentId: doc.id, category: doc.category, label, filename: doc.filename, fileSize: doc.file_size, success: true, ...parseResult });
        } catch (err) {
          results.push({ documentId: doc.id, category: doc.category, label, filename: doc.filename, success: false, error: err.message });
        }
      }
      setExtractProgress({ step: '완료!', current: crossDocs.length, total: crossDocs.length });
      setExtractResults(results);
      setTimeout(() => setExtractProgress({ step: '', current: 0, total: 0 }), 500);
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleAiReview = async () => {
    setReviewing(true);
    setReviewError(null);
    setReviewResult(null);
    try {
      setReviewProgress('📄 Excel 파일 분석 준비 중...');
      const crossDocs = documents.filter(doc =>
        CROSS_CATEGORIES.includes(doc.category) &&
        ['.xlsx', '.xls'].some(ext => (doc.filename || '').toLowerCase().endsWith(ext))
      );
      if (crossDocs.length === 0) throw new Error('교차 검토용 Excel 파일이 없습니다.');
      const excelData = [];
      for (let i = 0; i < crossDocs.length; i++) {
        const doc = crossDocs[i];
        const label = FILE_CATEGORY_LABELS[doc.category] || doc.category;
        setReviewProgress(`📄 추출 중: ${label} (${i + 1}/${crossDocs.length})`);
        const parseResult = await fetchAndParseExcel(supabase, doc.storage_path);
        excelData.push({ category: doc.category, label, filename: doc.filename, summary: parseResult.summary, sheets: parseResult.sheets });
      }
      setReviewProgress('🤖 Claude AI가 검토 중... (최대 30초 소요)');
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, projectName: project.name, excelData }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 429 && data.limit) {
          const nextReset = new Date(data.nextResetDate);
          const daysLeft = Math.ceil((nextReset - new Date()) / (1000 * 60 * 60 * 24));
          throw new Error(`이번 달 검토 한도(${data.limit}회)를 모두 사용했습니다. ${daysLeft}일 후에 다시 사용 가능합니다.`);
        }
        throw new Error(data.error || 'AI 검토 실패');
      }
      setReviewProgress('✅ 검토 완료!');
      setReviewResult(data);
      setTimeout(() => setReviewProgress(''), 1000);
    } catch (err) {
      setReviewError(err.message);
    } finally {
      setReviewing(false);
    }
  };
  const handleDeleteDoc = async (docId, storagePath) => {
    if (!confirm('이 파일을 삭제하시겠습니까?')) return;
    try {
      await supabase.storage.from('project-files').remove([storagePath]);
      await supabase.from('documents').delete().eq('id', docId);
      setDocuments(prev => prev.filter(d => d.id !== docId));
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  };
  const handleValidationUpload = async () => {
    if (!naeyeokseoFile) { alert('내역서 파일을 선택해주세요.'); return; }
    if (suryangsanchulFiles.length === 0) { alert('수량산출서 파일을 1개 이상 선택해주세요.'); return; }
    setUploadingValidation(true);
    setValidationUploadProgress('');
    setValidationUploadDone(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 필요합니다.');
      const allFiles = [
        { file: naeyeokseoFile, category: 'naeyeokseo' },
        ...suryangsanchulFiles.map(f => ({ file: f, category: 'suryangsanchul' })),
      ];
      for (let i = 0; i < allFiles.length; i++) {
        const { file, category } = allFiles[i];
        setValidationUploadProgress(`업로드 중: ${FILE_CATEGORY_LABELS[category]} - ${file.name} (${i + 1}/${allFiles.length})`);
        const ext = file.name.split('.').pop();
        const storagePath = `${user.id}/${projectId}/${category}_${Date.now()}_${i}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('project-files').upload(storagePath, file, { upsert: true });
        if (uploadError) throw new Error(`업로드 실패: ${file.name} - ${uploadError.message}`);
        const { error: dbError } = await supabase.from('documents').insert({
          project_id: projectId, user_id: user.id, category,
          filename: file.name, file_size: file.size, storage_path: storagePath,
        });
        if (dbError) throw new Error(`DB 저장 실패: ${file.name} - ${dbError.message}`);
      }
      setValidationUploadProgress('✅ 업로드 완료!');
      setValidationUploadDone(true);
      setNaeyeokseoFile(null);
      setSuryangsanchulFiles([]);
      const { data: docsData } = await supabase.from('documents').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
      setDocuments(docsData || []);
      setTimeout(() => setValidationUploadProgress(''), 2000);
    } catch (err) {
      setValidationUploadProgress(`❌ 오류: ${err.message}`);
    } finally {
      setUploadingValidation(false);
    }
  };
  const handleValidation = async () => {
    setValidating(true);
    setValidationError(null);
    setValidationResult(null);

    try {
      setValidationProgress('🔍 내역서 및 수량산출서 분석 중...');

      const response = await fetch('/api/review/validate-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '검증 실패');
      }

      setValidationProgress('✅ 검증 완료!');
      setValidationResult(data);
      setTimeout(() => setValidationProgress(''), 1000);
    } catch (err) {
      console.error('검증 에러:', err);
      setValidationError(err.message);
    } finally {
      setValidating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-gray-600">프로젝트 정보를 불러오는 중...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-3xl mx-auto">
          <Link href="/dashboard" className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-6 text-sm">← 대시보드로 돌아가기</Link>
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-900 mb-2">⚠️ 오류</h2>
            <p className="text-red-700">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const status = STATUS_BADGES[project.status] || STATUS_BADGES.pending;
  const validationDocs = documents.filter(doc => VALIDATION_CATEGORIES.includes(doc.category));
  const crossDocs = documents.filter(doc => CROSS_CATEGORIES.includes(doc.category));
  const crossExcelCount = crossDocs.filter(doc =>
    ['.xlsx', '.xls'].some(ext => (doc.filename || '').toLowerCase().endsWith(ext))
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard" className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4 text-sm">← 대시보드로 돌아가기</Link>

        {/* 헤더 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
          <div className="flex items-start justify-between mb-3">
            <h1 className="text-2xl font-bold text-gray-900 flex-1">🏗️ {project.name}</h1>
            <span className={`ml-3 px-3 py-1 text-xs font-semibold rounded-full ${status.className}`}>{status.label}</span>
          </div>
          <div className="text-sm text-gray-500">
            <span>📅 생성: {formatDate(project.created_at)}</span>
          </div>
        </div>

        {/* ⭐ 내역서 검증 섹션 */}
        <div className="bg-white rounded-lg shadow-sm border border-blue-300 p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">⭐</span>
            <h2 className="text-base font-semibold text-blue-900">내역서 검증</h2>
            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">NEW</span>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              📋 내역서 <span className="text-red-500">*</span>
              <span className="text-xs font-normal text-gray-500 ml-1">(1개, Excel)</span>
            </label>
            <input type="file" accept=".xlsx,.xls,.XLS,.XLSX"
              onChange={e => setNaeyeokseoFile(e.target.files[0] || null)}
              className="block w-full text-sm text-gray-700 border border-gray-300 rounded-lg px-3 py-2 cursor-pointer hover:border-blue-400 transition"
            />
            {naeyeokseoFile && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <span>📋</span>
                <span className="text-sm text-blue-800 truncate flex-1">{naeyeokseoFile.name}</span>
                <span className="text-xs text-gray-500">{formatFileSize(naeyeokseoFile.size)}</span>
                <button onClick={() => setNaeyeokseoFile(null)} className="text-red-400 hover:text-red-600 text-xs flex-shrink-0">❌</button>
              </div>
            )}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              📊 수량산출서 <span className="text-red-500">*</span>
              <span className="text-xs font-normal text-gray-500 ml-1">(여러 개 가능, Excel)</span>
            </label>
            <input type="file" accept=".xlsx,.xls,.XLS,.XLSX" multiple
              onChange={e => {
                const newFiles = Array.from(e.target.files);
                setSuryangsanchulFiles(prev => {
                  const existing = prev.map(f => f.name);
                  return [...prev, ...newFiles.filter(f => !existing.includes(f.name))];
                });
                e.target.value = '';
              }}
              className="block w-full text-sm text-gray-700 border border-gray-300 rounded-lg px-3 py-2 cursor-pointer hover:border-blue-400 transition"
            />
            {suryangsanchulFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {suryangsanchulFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                    <span>📊</span>
                    <span className="text-sm text-green-800 truncate flex-1">{file.name}</span>
                    <span className="text-xs text-gray-500">{formatFileSize(file.size)}</span>
                    <button onClick={() => setSuryangsanchulFiles(prev => prev.filter((_, i) => i !== idx))}
                      className="text-red-400 hover:text-red-600 text-xs flex-shrink-0">❌</button>
                  </div>
                ))}
                <p className="text-xs text-gray-500 mt-1">총 {suryangsanchulFiles.length}개 선택됨</p>
              </div>
            )}
          </div>

          <button onClick={handleValidationUpload}
            disabled={uploadingValidation || !naeyeokseoFile || suryangsanchulFiles.length === 0}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
            {uploadingValidation ? '⏳ 업로드 중...' : '📤 내역서 + 수량산출서 업로드'}
          </button>

          {validationUploadProgress && (
            <div className={`mt-3 px-3 py-2 rounded-lg text-sm ${
              validationUploadProgress.startsWith('❌') ? 'bg-red-50 text-red-700 border border-red-200' :
              validationUploadProgress.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' :
              'bg-blue-50 text-blue-700 border border-blue-200'
            }`}>
              {uploadingValidation && !validationUploadProgress.startsWith('✅') && (
                <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 align-middle"></span>
              )}
              {validationUploadProgress}
            </div>
          )}

{validationUploadDone && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">✅ 업로드 완료! 아래 검증 시작 버튼을 눌러주세요.</p>
            </div>
          )}

          {/* 검증 시작 버튼 */}
          {validationDocs.length > 0 && (
            <button
              onClick={handleValidation}
              disabled={validating}
              className="mt-4 w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium">
              {validating ? '🔍 검증 중...' : '🔍 내역서 검증 시작'}
              <span className="block text-xs font-normal text-green-100 mt-0.5">내역서 수량과 수량산출서 집계를 AI가 비교 검증합니다</span>
            </button>
          )}



          {/* 업로드된 내역서/수량산출서 목록 */}
          {validationDocs.length > 0 && (
            <div className="mt-4 pt-4 border-t border-blue-100">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                📎 업로드된 파일 <span className="text-gray-400">({validationDocs.length}개)</span>
              </h3>
              <div className="space-y-1">
                {validationDocs.map((doc) => {
                  const isExcel = ['.xlsx', '.xls'].some(ext => (doc.filename || '').toLowerCase().endsWith(ext));
                  return (
                    <div key={doc.id} className="flex items-center gap-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                      <span className="text-base flex-shrink-0">{FILE_CATEGORY_EMOJIS[doc.category] || '📄'}</span>
                      <span className="text-sm font-medium text-gray-900 w-24 flex-shrink-0">{FILE_CATEGORY_LABELS[doc.category] || doc.category}</span>
                      <span className="text-sm flex-shrink-0">{isExcel ? '📗' : '📄'}</span>
                      <span className="text-sm text-gray-700 truncate flex-1 min-w-0">{doc.filename}</span>
                      <span className="text-xs text-gray-500 flex-shrink-0">{formatFileSize(doc.file_size)}</span>
                      {isExcel && <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded flex-shrink-0">분석 대상</span>}
                      <button
                        onClick={() => handleDeleteDoc(doc.id, doc.storage_path)}
                        className="text-red-400 hover:text-red-600 text-xs flex-shrink-0 ml-1">❌</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 📋 5개 파일 교차 검토 섹션 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">📋</span>
            <h2 className="text-base font-semibold text-gray-900">5개 파일 교차 검토</h2>
          </div>

          {crossDocs.length > 0 ? (
            <div className="space-y-1 mb-4">
              {crossDocs.map((doc) => {
                const isExcel = ['.xlsx', '.xls'].some(ext => (doc.filename || '').toLowerCase().endsWith(ext));
                const isPdf = (doc.filename || '').toLowerCase().endsWith('pdf');
                return (
                  <div key={doc.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                    <span className="text-base flex-shrink-0">{FILE_CATEGORY_EMOJIS[doc.category] || '📄'}</span>
                    <span className="text-sm font-medium text-gray-900 w-24 flex-shrink-0">{FILE_CATEGORY_LABELS[doc.category] || doc.category}</span>
                    <span className="text-sm flex-shrink-0">{isPdf ? '📕' : isExcel ? '📗' : '📄'}</span>
                    <span className="text-sm text-gray-700 truncate flex-1 min-w-0">{doc.filename}</span>
                    <span className="text-xs text-gray-500 flex-shrink-0">{formatFileSize(doc.file_size)}</span>
                    {isPdf && <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-600 rounded flex-shrink-0">보관용</span>}
                    {isExcel && <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded flex-shrink-0">분석 대상</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4 mb-4">업로드된 파일이 없습니다.</p>
          )}

          <div className="space-y-2">
            <button onClick={handleExtractText} disabled={extracting || reviewing || crossExcelCount === 0}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium text-left">
              {extracting ? '⏳ 추출 중...' : '📊 Excel 텍스트 추출 미리보기'}
              <span className="block text-xs font-normal text-blue-100 mt-0.5">Excel 파일 {crossExcelCount}개를 분석 가능한 텍스트로 변환</span>
            </button>
            <button onClick={handleAiReview} disabled={reviewing || extracting || crossExcelCount === 0}
              className="w-full px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium text-left">
              {reviewing ? '🤖 AI 검토 진행 중...' : '🤖 AI 검토 시작 (Claude)'}
              <span className="block text-xs font-normal text-purple-100 mt-0.5">Claude AI가 단가 검증 및 이슈 발견 (소요시간 ~30초)</span>
            </button>
          </div>
        </div>

        {/* 결과 패널들 */}
        {extracting && extractProgress.step && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm font-medium text-blue-900">{extractProgress.step}</p>
            </div>
            {extractProgress.total > 0 && (
              <div className="ml-8">
                <div className="flex justify-between text-xs text-blue-700 mb-1">
                  <span>진행률</span><span>{extractProgress.current} / {extractProgress.total}</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${(extractProgress.current / extractProgress.total) * 100}%` }}></div>
                </div>
              </div>
            )}
          </div>
        )}

        {extractError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-700">⚠️ {extractError}</p>
          </div>
        )}

        {extractResults && (
          <div className="space-y-4 mb-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h2 className="text-base font-semibold text-green-900 mb-2">✅ 추출 완료!</h2>
              <p className="text-sm text-green-700">{extractResults.filter(r => r.success).length} / {extractResults.length}개 파일 추출 성공</p>
            </div>
            {extractResults.map((result) => (
              <ExtractResultCard key={result.documentId} result={result} />
            ))}
          </div>
        )}

        {reviewing && reviewProgress && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm font-medium text-purple-900">{reviewProgress}</p>
            </div>
          </div>
        )}

        {reviewError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-700">⚠️ AI 검토 실패: {reviewError}</p>
          </div>
        )}

        {reviewResult && reviewResult.result && (
          <ReviewResultPanel data={reviewResult} />
        )}
        {/* 검증 진행 */}
        {validating && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm font-medium text-green-900">{validationProgress}</p>
            </div>
          </div>
        )}

        {validationError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-700">⚠️ 검증 실패: {validationError}</p>
          </div>
        )}

        {validationResult && validationResult.result && (
          <ValidationResultPanel data={validationResult} />
        )}
      </div>
    </div>
  );
}
// 검증 결과 패널
function ValidationResultPanel({ data }) {
  const { result, usage } = data;
  const { results, summary } = result;

  return (
    <div className="space-y-4 mb-4">
      {/* 요약 */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-green-900">🔍 내역서 검증 완료</h2>
          {usage && (
            <span className="text-xs text-green-600">⏱ {usage.elapsedSeconds}초</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-green-100 rounded p-2 text-center">
            <p className="text-xs text-green-700">✅ 일치</p>
            <p className="text-2xl font-bold text-green-700">{summary?.matched_ok || 0}</p>
          </div>
          <div className="bg-red-100 rounded p-2 text-center">
            <p className="text-xs text-red-700">⚠️ 불일치</p>
            <p className="text-2xl font-bold text-red-700">{summary?.matched_diff || 0}</p>
          </div>
          <div className="bg-gray-100 rounded p-2 text-center">
            <p className="text-xs text-gray-700">❓ 매칭실패</p>
            <p className="text-2xl font-bold text-gray-700">{summary?.unmatched || 0}</p>
          </div>
        </div>
      </div>

      {/* 결과 테이블 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            📋 품목별 검증 결과
            <span className="ml-2 text-sm font-normal text-gray-500">({results?.length || 0}개)</span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">공종명</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">규격</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">단위</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">내역서 수량</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">산출서 수량</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">차이</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-600">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {results?.map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-900 max-w-[180px] truncate">{item.naeyeokseo_item}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 max-w-[100px] truncate">{item.gyugyeok || '-'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{item.danwi}</td>
                  <td className={`px-3 py-2 text-xs text-right font-medium ${
                    item.status === '불일치' ? 'bg-red-50 text-red-700' :
                    item.status === '일치' ? 'text-green-700' : 'text-gray-500'
                  }`}>
                    {item.naeyeokseo_suryang?.toLocaleString() || '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-right text-gray-700">
                    {item.sanchul_suryang?.toLocaleString() || '-'}
                  </td>
                  <td className={`px-3 py-2 text-xs text-right font-medium ${
                    item.difference > 0 ? 'text-red-600' :
                    item.difference < 0 ? 'text-blue-600' : 'text-gray-400'
                  }`}>
                    {item.difference != null ? (item.difference > 0 ? '+' : '') + item.difference.toLocaleString() : '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-center">
                    {item.status === '일치' && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full">✅ 일치</span>}
                    {item.status === '불일치' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full">⚠️ 불일치</span>}
                    {item.status === '매칭실패' && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">❓ 매칭실패</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ExtractResultCard({ result }) {
  const [expanded, setExpanded] = useState(false);
  if (!result.success) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-red-900 mb-1">❌ {result.label} - 추출 실패</h3>
        <p className="text-xs text-red-600">{result.filename}</p>
        <p className="text-xs text-red-700 mt-2">{result.error}</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 cursor-pointer hover:bg-gray-100 transition" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">📗 {result.label}<span className="ml-2 text-xs font-normal text-gray-500">{result.filename}</span></h3>
            <p className="text-xs text-gray-600 mt-0.5">{result.summary}</p>
          </div>
          <span className="text-xs text-gray-500 flex-shrink-0 ml-3">{expanded ? '▼ 접기' : '▶ 펼치기'}</span>
        </div>
      </div>
      {expanded && (
        <div className="p-4 space-y-4">
          {result.sheets.map((sheet, sheetIdx) => (
            <div key={sheetIdx}>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">
                📄 시트 {sheetIdx + 1}: {sheet.name}<span className="ml-2 text-xs font-normal text-gray-500">({sheet.rowCount}행 × {sheet.colCount}열)</span>
              </h4>
              {sheet.rows.length === 0 ? (
                <p className="text-xs text-gray-500 italic">(빈 시트)</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs border border-gray-200">
                    <tbody>
                      {sheet.rows.slice(0, 10).map((row, rowIdx) => (
                        <tr key={rowIdx} className={rowIdx === 0 ? 'bg-blue-50 font-semibold' : 'hover:bg-gray-50'}>
                          {row.slice(0, 8).map((cell, cellIdx) => (
                            <td key={cellIdx} className="border border-gray-200 px-2 py-1 truncate max-w-[150px]">{String(cell || '')}</td>
                          ))}
                          {row.length > 8 && <td className="border border-gray-200 px-2 py-1 text-gray-400 italic">... +{row.length - 8}열</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sheet.rows.length > 10 && <p className="text-xs text-gray-500 mt-1 italic">... 외 {sheet.rows.length - 10}행 더 있음</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewResultPanel({ data }) {
  const { result, usage } = data;
  const { summary, totalIssues, severity, issues, recommendations } = result;
  return (
    <div className="space-y-4">
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-purple-900">🤖 Claude AI 검토 완료</h2>
          {usage && (
            <span className="text-xs text-purple-600">⏱ {usage.elapsedSeconds}초 · {(usage.inputTokens + usage.outputTokens).toLocaleString()} 토큰</span>
          )}
        </div>
        <p className="text-sm text-purple-800 mb-4 leading-relaxed">{summary}</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-red-100 rounded p-2 text-center">
            <p className="text-xs text-red-700">🔴 심각</p>
            <p className="text-2xl font-bold text-red-700">{severity?.critical || 0}</p>
          </div>
          <div className="bg-yellow-100 rounded p-2 text-center">
            <p className="text-xs text-yellow-700">🟡 경고</p>
            <p className="text-2xl font-bold text-yellow-700">{severity?.warning || 0}</p>
          </div>
          <div className="bg-blue-100 rounded p-2 text-center">
            <p className="text-xs text-blue-700">🔵 정보</p>
            <p className="text-2xl font-bold text-blue-700">{severity?.info || 0}</p>
          </div>
        </div>
      </div>
      {issues && issues.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            🔍 발견된 이슈 <span className="text-sm font-normal text-gray-500">({totalIssues}개)</span>
          </h2>
          <div className="space-y-3">
            {issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
          </div>
        </div>
      )}
      {recommendations && recommendations.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">💡 종합 권장사항</h2>
          <ul className="space-y-2">
            {recommendations.map((rec, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-purple-600 flex-shrink-0">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function IssueCard({ issue }) {
  const [expanded, setExpanded] = useState(false);
  const style = SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.info;
  return (
    <div className={`border ${style.borderColor} ${style.bgColor} rounded-lg overflow-hidden`}>
      <div className="px-4 py-3 cursor-pointer hover:bg-opacity-70 transition" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${style.badgeColor} flex-shrink-0`}>{style.label}</span>
            <span className="text-xs text-gray-500 flex-shrink-0">[{issue.category}]</span>
            <h3 className={`text-sm font-medium ${style.titleColor} truncate`}>{issue.title}</h3>
          </div>
          <span className="text-xs text-gray-500 flex-shrink-0">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 text-sm">
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1">📋 설명</p>
            <p className="text-gray-700 leading-relaxed">{issue.description}</p>
          </div>
          {issue.evidence && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">🔍 근거</p>
              <p className="text-gray-700 leading-relaxed bg-white p-2 rounded border border-gray-200">{issue.evidence}</p>
            </div>
          )}
          {issue.recommendation && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">💡 권장 조치</p>
              <p className="text-gray-700 leading-relaxed">{issue.recommendation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
